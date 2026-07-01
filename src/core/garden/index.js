"use strict";

const obsidian_1 = require("obsidian");
const { KNOWN_TOKENS, isImageFile, getMimeType } = require("../../constants");
const { StndConfirmModal } = require("../../ui/confirm-modal");

// ─── Sync Progress Modal ──────────────────────────────────────────────────────
// Live feedback for "Sync all published": a progress bar, the current note,
// running ok/fail counts, a rolling error list, and a Cancel button. The sync
// loop polls `.cancelled` to stop early and calls update()/addError()/done().
class SyncProgressModal extends obsidian_1.Modal {
  constructor(app, total) {
    super(app);
    this.total = total;
    this.cancelled = false;
    this.finished = false;
    this.syncedNotes = [];      // Pushed to remote
    this.pulledNotes = [];      // Pulled from remote
    this.createdNotes = [];     // Created locally
    this.unpublishedNotes = []; // Removed publish status locally
    this.skippedNotes = [];     // Skipped because identical
    this.failedNotes = [];      // Errors
    this.startTime = Date.now();
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    contentEl.addClass("stnd-modal");
    titleEl.setText("Standard — Synchronisation du jardin");

    this.statusEl = contentEl.createEl("p", {
      text: `Préparation... 0 / ${this.total}`,
      cls: "stnd-modal-message",
    });

    const track = contentEl.createDiv();
    track.style.cssText =
      "height:8px;border-radius:4px;background:var(--background-modifier-border);overflow:hidden;margin:0.5em 0;";
    this.barEl = track.createDiv();
    this.barEl.style.cssText =
      "height:100%;width:0%;background:var(--interactive-accent);transition:width .15s ease;";

    this.currentEl = contentEl.createEl("div", {
      cls: "stnd-modal-detail",
      text: "Vérification des notes existantes...",
    });
    this.currentEl.style.cssText =
      "opacity:.7;font-size:var(--font-ui-smaller);min-height:1.4em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    this.reconciliationEl = contentEl.createEl("div");
    this.reconciliationEl.style.cssText = "margin-top:1em; max-height: 250px; overflow-y: auto; font-size:var(--font-ui-smaller);";

    const btns = contentEl.createEl("div", { cls: "stnd-modal-btns" });
    this.actionBtn = btns.createEl("button", { text: "Annuler", cls: "mod-warning" });
    this.actionBtn.addEventListener("click", () => {
      if (this.finished) return this.close();
      this.cancelled = true;
      this.actionBtn.disabled = true;
      this.actionBtn.setText("Annulation...");
    });
  }

  update({ index, current, synced, pulled, created, unpublished, skipped, failed }) {
    if (!this.barEl) return;
    const pct = this.total ? Math.round((index / this.total) * 100) : 0;
    this.barEl.style.width = pct + "%";
    
    const activeActions = synced + pulled + created + unpublished;
    this.statusEl.setText(
      `${index} / ${this.total} (${pct}%) — ${activeActions} action(s), ${skipped} identique(s)` +
        (failed ? `, ${failed} échoué(s)` : ""),
    );
    this.currentEl.setText(current ? `Traitement : ${current}` : "");
  }

  recordResult(type, name) {
    if (type === "synced") this.syncedNotes.push(name);
    else if (type === "pulled") this.pulledNotes.push(name);
    else if (type === "created") this.createdNotes.push(name);
    else if (type === "unpublished") this.unpublishedNotes.push(name);
    else if (type === "skipped") this.skippedNotes.push(name);
    else if (type === "failed") this.failedNotes.push(name);
  }

  done({ synced, pulled, created, unpublished, skipped, failed }) {
    this.finished = true;
    if (!this.barEl) return;
    const secs = Math.round((Date.now() - this.startTime) / 1000);
    this.barEl.style.width = "100%";
    const verb = this.cancelled ? "Annulée" : "Terminée";
    this.statusEl.setText(
      `Synchronisation ${verb.toLowerCase()} · ${secs}s`,
    );
    this.currentEl.setText("");

    // Rapport de réconciliation
    this.reconciliationEl.empty();
    
    const summaryHeader = this.reconciliationEl.createEl("h4", {
      text: "Rapport de réconciliation bidirectionnelle :",
      cls: "stnd-reconciliation-title"
    });
    summaryHeader.style.cssText = "margin: 0 0 0.5em 0;";

    const ul = this.reconciliationEl.createEl("ul");
    ul.style.cssText = "list-style-type: none; padding-left: 0; margin: 0;";

    const addList = (notes, title, colorStyle, prefix) => {
      if (notes.length === 0) return;
      const li = ul.createEl("li");
      li.style.cssText = `${colorStyle} font-weight: bold; margin-bottom: 0.25em;`;
      li.setText(`${prefix} ${title} (${notes.length}) :`);
      const subUl = ul.createEl("ul");
      subUl.style.cssText = "padding-left: 1.5em; margin-bottom: 0.5em; list-style-type: circle;";
      for (const n of notes) {
        subUl.createEl("li", { text: n });
      }
    };

    addList(this.syncedNotes, "Envoyée(s) / Mise(s) à jour à distance", "color: var(--text-success);", "↑");
    addList(this.pulledNotes, "Téléchargée(s) / Mise(s) à jour localement", "color: var(--text-success);", "↓");
    addList(this.createdNotes, "Créée(s) localement", "color: var(--text-success);", "+");
    addList(this.unpublishedNotes, "Dé-publiée(s) localement (passée en brouillon)", "color: var(--text-warning);", "-");
    addList(this.skippedNotes, "Déjà à jour (identiques)", "color: var(--text-muted);", "○");
    addList(this.failedNotes, "Échec(s) de synchronisation", "color: var(--text-error);", "✗");

    this.actionBtn.disabled = false;
    this.actionBtn.setText("Fermer");
    this.actionBtn.removeClass("mod-warning");
    this.actionBtn.addClass("mod-cta");
  }

  onClose() {
    // Closing the modal (Esc / click-away) before it's done cancels the sync,
    // so work never continues invisibly behind a dismissed dialog.
    if (!this.finished) this.cancelled = true;
    this.contentEl.empty();
  }
}

async function fetchWithRetry(url, options = {}, maxAttempts = 5) {
  let attempt = 0;
  let delay = 2000;
  while (true) {
    attempt++;
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        if (attempt >= maxAttempts) {
          return res;
        }
        const retryHeader = res.headers.get("Retry-After");
        let waitMs = 0;
        if (retryHeader) {
          const seconds = parseInt(retryHeader, 10);
          waitMs = isNaN(seconds) ? delay : seconds * 1000;
        } else {
          waitMs = delay + Math.random() * 1000;
          delay *= 2;
        }
        console.warn(
          `Standard: Rate limited (429). Retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw err;
      }
      const waitMs = delay + Math.random() * 1000;
      delay *= 2;
      console.warn(
        `Standard: Network error. Retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})...`,
        err
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

// ─── Garden ───────────────────────────────────────────────────────────────────
// Standard Garden publish + AI-token client. Talks to the standard.garden API:
// verifies the API key, publishes/unpublishes notes (uploading embedded images
// to the CDN), and requests AI-generated design tokens.

class GardenFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.syncIntervalTimer = null;
  }

  async load() {
    if (this.plugin.settings.autoSyncStartup && this.plugin.settings.apiKey) {
      setTimeout(() => {
        this.syncAllPublished();
      }, 5000);
    }
    this.setupAutoSyncInterval();
  }

  unload() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }
  }

  setupAutoSyncInterval() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }

    const minutes = parseInt(this.plugin.settings.autoSyncInterval, 10) || 0;
    if (minutes > 0 && this.plugin.settings.apiKey) {
      const timer = window.setInterval(() => {
        this.syncAllPublished();
      }, minutes * 60 * 1000);
      
      this.syncIntervalTimer = timer;
      this.plugin.registerInterval(timer);
    }
  }



  checkApiKeyAndShowModal() {
    if (!this.plugin.settings.apiKey) {
      new StndConfirmModal(
        this.app,
        "No API key configured.\nTo publish or edit a post, you must link your account.",
        "Connect",
        () => this.startConnect()
      ).open();
      return false;
    }
    return true;
  }

  async verifyApiKey(statusEl, onComplete) {
    if (!this.plugin.settings.apiKey) {
      this.plugin.settings.apiUsername = "";
      await this.plugin.saveSettings();
      this.plugin.updateRibbonIconsVisibility();
      if (onComplete) onComplete();
      return;
    }
    try {
      const response = await fetch(`${this.plugin.settings.apiUrl}/me`, {
        headers: { "x-api-key": this.plugin.settings.apiKey },
      });
      if (response.ok) {
        const data = await response.json();
        this.plugin.settings.apiUsername = data.username || "";
        await this.plugin.saveSettings();
        this.plugin.updateRibbonIconsVisibility();
        if (statusEl) statusEl.setText(`✓ @${data.username}`);
      } else {
        this.plugin.settings.apiUsername = "";
        await this.plugin.saveSettings();
        this.plugin.updateRibbonIconsVisibility();
        if (statusEl) statusEl.setText("✗ Invalid key");
      }
    } catch {
      if (statusEl) statusEl.setText("✗ Could not connect");
    }
    if (onComplete) onComplete();
  }

  // ── Account linking (no copy-paste key) ──────────────────────────────────────
  // Opens the garden's /connect-obsidian page in the browser with a one-time
  // `state` nonce. After the user signs in, that page deep-links back via
  // obsidian://standard-connect (handled in main.js → handleConnectCallback).
  startConnect() {
    const base = (this.plugin.settings.apiUrl || "https://standard.garden/api")
      .replace(/\/api\/?$/, "");
    const state =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Math.random()).slice(2);
    this._connectState = state;
    const url = `${base}/connect-obsidian?state=${encodeURIComponent(state)}`;
    this._openExternal(url);
    new obsidian_1.Notice("Standard : connexion ouverte dans le navigateur…");
  }

  // The connect page hands the key back via an `obsidian://standard-connect`
  // deep link, which only routes to Obsidian from the SYSTEM browser. A plain
  // `window.open` gets captured by the Web viewer core plugin and rendered in an
  // in-app <webview>, where `obsidian://` goes nowhere (the "Retour à Obsidian"
  // button looks dead). So on desktop we hand off through Electron's shell,
  // which always opens the OS default browser; mobile uses window.open.
  _openExternal(url) {
    if (obsidian_1.Platform.isDesktop) {
      try {
        require("electron").shell.openExternal(url);
        return;
      } catch (e) {
        // Fall through to window.open if Electron isn't reachable.
      }
    }
    window.open(url, "_blank");
  }

  async handleConnectCallback(params) {
    const key = params && params.key;
    const username = (params && params.username) || "";
    const state = (params && params.state) || "";
    if (!key) {
      new obsidian_1.Notice("Garden: connection cancelled (missing key).");
      return;
    }
    // Reject a callback that doesn't match the nonce we opened with.
    if (this._connectState && state !== this._connectState) {
      new obsidian_1.Notice("Garden: connection skipped (invalid token).");
      return;
    }
    this._connectState = null;
    this.plugin.settings.apiKey = key;
    this.plugin.settings.apiUsername = username;
    await this.plugin.saveSettings();
    // Confirm the key works (also sets the verified username + ribbon icons).
    await this.verifyApiKey(null, () => {
      if (this.plugin.settingTab) {
        this.plugin.settingTab.display();
      }
    });
    const who = this.plugin.settings.apiUsername || username;
    new obsidian_1.Notice(
      who ? `Garden: connected as @${who} ✓` : "Garden: connected ✓",
    );
  }

  async syncAllPublished() {
    if (!this.checkApiKeyAndShowModal()) {
      return;
    }
    const files = this.app.vault.getMarkdownFiles();
    const publishKey =
      (this.plugin.settings.keyPrefix || "") + this.plugin.settings.publishKey;

    try {
      // 1. Fetch remote list of published notes with content
      const res = await fetchWithRetry(`${this.plugin.settings.apiUrl}/publish?includeContent=true`, {
        method: "GET",
        headers: { "x-api-key": this.plugin.settings.apiKey },
      });

      let remoteNotes = [];
      if (res.ok) {
        const data = await res.json();
        remoteNotes = data.notes || [];
      } else {
        console.warn("Standard : Impossible de récupérer la liste distante pour la réconciliation.");
      }

      const remoteBySlug = new Map(remoteNotes.map((n) => [n.slug, n]));
      const syncTasks = [];

      // Gather local files and map by slug
      const localFilesBySlug = new Map();
      for (const file of files) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        const fmSlug = fm.permalink ?? fm.slug;
        const basenameSlug = file.basename
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const resolved =
          fmSlug != null ? String(fmSlug).replace(/^\/+|\/+$/g, "") : basenameSlug;
        const slug = resolved === "" ? "~root" : resolved;

        localFilesBySlug.set(slug, file);

        const isPublishedLocal = fm[publishKey] === true;
        const hasGardenUrl = fm.garden_url != null;
        const remoteNote = remoteBySlug.get(slug);

        if (isPublishedLocal) {
          syncTasks.push({
            type: "local_published",
            file,
            remoteNote,
            slug,
            name: file.basename,
          });
        } else if (remoteNote) {
          // Brouillon localement, mais existe en ligne -> Réconciliation
          if (this.plugin.settings.syncDirection === "2way") {
            syncTasks.push({
              type: "local_draft_remote_exists",
              file,
              remoteNote,
              slug,
              name: file.basename,
            });
          }
        } else if (hasGardenUrl) {
          // Brouillon local, n'existe pas en ligne, mais possède encore une garden_url.
          // Signifie qu'il a été supprimé en ligne. On nettoie le fichier local.
          if (this.plugin.settings.syncDirection === "2way") {
            syncTasks.push({
              type: "local_published",
              file,
              remoteNote,
              slug,
              name: file.basename,
            });
          }
        }
      }

      // Gather remote-only notes (created online)
      if (this.plugin.settings.syncDirection === "2way") {
        for (const remoteNote of remoteNotes) {
          if (!localFilesBySlug.has(remoteNote.slug)) {
            syncTasks.push({
              type: "remote_only",
              file: null,
              remoteNote,
              slug: remoteNote.slug,
              name: remoteNote.title || remoteNote.slug,
            });
          }
        }
      }

      if (syncTasks.length === 0) {
        new obsidian_1.Notice("Standard : Aucune note à synchroniser.");
        return;
      }

      const modal = new SyncProgressModal(this.app, syncTasks.length);
      modal.open();

      let synced = 0;
      let pulled = 0;
      let created = 0;
      let unpublished = 0;
      let skipped = 0;
      let failed = 0;
      let i = 0;

      for (const task of syncTasks) {
        if (modal.cancelled) break;
        modal.update({ index: i, current: task.name, synced, pulled, created, unpublished, skipped, failed });

        // Throttle 1s between notes in bulk sync
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (modal.cancelled) break;

        try {
          if (task.type === "local_published") {
            const { file, remoteNote } = task;
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
            const hasGardenUrl = fm.garden_url != null;

            if (!remoteNote) {
              // Deleted remotely!
              if (hasGardenUrl) {
                if (this.plugin.settings.syncDirection === "1way") {
                  // In 1-way mode, local wins: republish to remote
                  const raw = await this.app.vault.read(file);
                  const finalContent = await this.uploadContentImages(raw, file, true);
                  const result = await this.publishNote(file, true, finalContent);
                  if (result) {
                    synced++;
                    modal.recordResult("synced", file.basename);
                  } else {
                    failed++;
                    modal.recordResult("failed", file.basename);
                  }
                } else {
                  // In 2-way mode, delete locally (mark publish: false)
                  await this.app.fileManager.processFrontMatter(file, (fm) => {
                    fm[publishKey] = false;
                    delete fm.garden_url;
                  });
                  unpublished++;
                  modal.recordResult("unpublished", file.basename);
                }
              } else {
                // New local note, push it!
                const raw = await this.app.vault.read(file);
                const finalContent = await this.uploadContentImages(raw, file, true);
                const result = await this.publishNote(file, true, finalContent);
                if (result) {
                  synced++;
                  modal.recordResult("synced", file.basename);
                } else {
                  failed++;
                  modal.recordResult("failed", file.basename);
                }
              }
            } else {
              // Exists on both sides, compare content
              const raw = await this.app.vault.read(file);
              const finalContent = await this.uploadContentImages(raw, file, true);

              // Compute local hash
              const hashBuffer = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(finalContent)
              );
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              const localHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

              if (remoteNote.hash === localHash) {
                skipped++;
                modal.recordResult("skipped", file.basename);
              } else {
                // Different content
                if (this.plugin.settings.syncDirection === "1way") {
                  // In 1-way mode, local always wins: push local content to remote
                  const result = await this.publishNote(file, true, finalContent);
                  if (result) {
                    synced++;
                    modal.recordResult("synced", file.basename);
                  } else {
                    failed++;
                    modal.recordResult("failed", file.basename);
                  }
                } else {
                  // In 2-way mode, compare mtimes
                  const localMtime = file.stat?.mtime || 0;
                  const remoteMtime = new Date(remoteNote.updated_at).getTime() || 0;

                  if (remoteMtime > localMtime + 5000) {
                    // Pull! Update local content
                    await this.app.vault.modify(file, remoteNote.content);
                    pulled++;
                    modal.recordResult("pulled", file.basename);
                  } else {
                    // Push! Update remote
                    const result = await this.publishNote(file, true, finalContent);
                    if (result) {
                      synced++;
                      modal.recordResult("synced", file.basename);
                    } else {
                      failed++;
                      modal.recordResult("failed", file.basename);
                    }
                  }
                }
              }
            }
          } 
          
          else if (task.type === "local_draft_remote_exists") {
            const { file, remoteNote } = task;
            const localMtime = file.stat?.mtime || 0;
            const remoteMtime = new Date(remoteNote.updated_at).getTime() || 0;

            if (remoteMtime > localMtime + 5000) {
              // Remote edit wins: Pull remote change and mark publish: true
              await this.app.vault.modify(file, remoteNote.content);
              await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm[publishKey] = true;
                fm.garden_url = this.getLiveUrl(file);
              });
              pulled++;
              modal.recordResult("pulled", file.basename);
            } else {
              // Local draft wins: Keep draft locally, unpublish remotely
              const ok = await this.unpublishNote(file);
              if (ok) {
                unpublished++;
                modal.recordResult("unpublished", file.basename);
              } else {
                failed++;
                modal.recordResult("failed", file.basename);
              }
            }
          } 
          
          else if (task.type === "remote_only") {
            const { remoteNote, slug } = task;
            // Created online, pull and create local file
            let safeTitle = (remoteNote.title || slug)
              .replace(/[\\\/:\*\?"<>\|]/g, "-")
              .trim();
            if (!safeTitle) safeTitle = "Sans titre";

            let finalPath = `${safeTitle}.md`;
            let count = 1;
            while (this.app.vault.getAbstractFileByPath(finalPath)) {
              finalPath = `${safeTitle} (${count}).md`;
              count++;
            }

            const file = await this.app.vault.create(finalPath, remoteNote.content);
            await this.app.fileManager.processFrontMatter(file, (fm) => {
              fm[publishKey] = true;
              fm.garden_url = this.getLiveUrl(file);
            });

            created++;
            modal.recordResult("created", file.basename);
          }
        } catch (err) {
          console.error(`Standard : Erreur lors de la synchronisation de ${task.name}:`, err);
          failed++;
          modal.recordResult("failed", task.name);
        }

        i++;
        modal.update({ index: i, current: task.name, synced, pulled, created, unpublished, skipped, failed });
      }

      modal.done({ synced, pulled, created, unpublished, skipped, failed });

      new obsidian_1.Notice(
        `Garden : Synchronisation ${modal.cancelled ? "annulée" : "terminée"}. ${synced + pulled + created + unpublished} action(s), ${skipped} identique(s), ${failed} en échec.`,
      );
    } catch (err) {
      console.error("Standard : Erreur globale lors de la synchronisation en lot :", err);
      new obsidian_1.Notice("Standard : Erreur lors de la synchronisation.");
    }
  }

  async downloadNewOnlineNotes() {
    if (!this.checkApiKeyAndShowModal()) {
      return;
    }
    const files = this.app.vault.getMarkdownFiles();
    const publishKey =
      (this.plugin.settings.keyPrefix || "") + this.plugin.settings.publishKey;

    try {
      const res = await fetchWithRetry(`${this.plugin.settings.apiUrl}/publish?includeContent=true`, {
        method: "GET",
        headers: { "x-api-key": this.plugin.settings.apiKey },
      });

      let remoteNotes = [];
      if (res.ok) {
        const data = await res.json();
        remoteNotes = data.notes || [];
      } else {
        new obsidian_1.Notice("Garden: Failed to fetch online notes list.");
        return;
      }

      const localFilesBySlug = new Map();
      for (const file of files) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        const fmSlug = fm.permalink ?? fm.slug;
        const basenameSlug = file.basename
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const resolved =
          fmSlug != null ? String(fmSlug).replace(/^\/+|\/+$/g, "") : basenameSlug;
        const slug = resolved === "" ? "~root" : resolved;
        localFilesBySlug.set(slug, file);
      }

      const remoteOnly = [];
      for (const remoteNote of remoteNotes) {
        if (!localFilesBySlug.has(remoteNote.slug)) {
          remoteOnly.push(remoteNote);
        }
      }

      if (remoteOnly.length === 0) {
        new obsidian_1.Notice("Garden: No new online notes to download.");
        return;
      }

      let created = 0;
      for (const remoteNote of remoteOnly) {
        let safeTitle = (remoteNote.title || remoteNote.slug)
          .replace(/[\\\/:\*\?"<>\|]/g, "-")
          .trim();
        if (!safeTitle) safeTitle = "Untitled";

        let finalPath = `${safeTitle}.md`;
        let count = 1;
        while (this.app.vault.getAbstractFileByPath(finalPath)) {
          finalPath = `${safeTitle} (${count}).md`;
          count++;
        }

        const file = await this.app.vault.create(finalPath, remoteNote.content);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm[publishKey] = true;
          fm.garden_url = this.getLiveUrl(file);
        });
        created++;
      }

      new obsidian_1.Notice(`Garden: Downloaded ${created} new note(s) successfully!`);
    } catch (err) {
      console.error("Garden: Error during downloading online notes:", err);
      new obsidian_1.Notice("Garden: Failed to download online notes.");
    }
  }

  async publishCurrentNote() {
    if (!this.checkApiKeyAndShowModal()) {
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new obsidian_1.Notice("Standard: No active note to publish.");
      return;
    }
    const result = await this.publishWithCheck(activeFile);
    if (result === true) {
      new obsidian_1.Notice(`Standard: "${activeFile.basename}" published.`);
      if (this.plugin.settings.openAfterPublish) {
        this.viewLiveVersion();
      }
    } else if (result === false) {
      new obsidian_1.Notice(
        `Standard: Failed to publish "${activeFile.basename}".`,
      );
    }
    // null = user cancelled the confirmation modal — do nothing
  }

  // Unpublish the active note: removes the online version (with confirmation)
  // and clears the publish keys from frontmatter. The local file is untouched.
  async unpublishCurrentNote() {
    if (!this.checkApiKeyAndShowModal()) {
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new obsidian_1.Notice("Standard: No active note to unpublish.");
      return;
    }
    const result = await this.deleteOnlineVersion(activeFile);
    if (result === true) {
      new obsidian_1.Notice(
        `Standard: "${activeFile.basename}" removed from the garden.`,
      );
    } else if (result === false) {
      new obsidian_1.Notice(
        `Standard: Failed to unpublish "${activeFile.basename}".`,
      );
    }
    // null = cancelled
  }

  getGardenDomain() {
    try {
      const files = this.app.vault.getMarkdownFiles();
      for (const file of files) {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};
        if (fm.permalink === "/" && fm.garden_domain) {
          return String(fm.garden_domain)
            .trim()
            .replace(/^https?:\/\//, "")
            .replace(/\/$/, "");
        }
      }
    } catch (e) {
      console.error("Standard: Error scanning for garden_domain:", e);
    }
    return null;
  }

  getLiveUrl(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const fmSlug = fm.permalink ?? fm.slug;
    const basenameSlug = file.basename
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const resolved =
      fmSlug != null ? String(fmSlug).replace(/^\/+|\/+$/g, "") : basenameSlug;

    const domain = this.getGardenDomain();
    if (domain) {
      return resolved === ""
        ? `https://${domain}`
        : `https://${domain}/${resolved}`;
    } else {
      const base = "https://standard.garden";
      return resolved === ""
        ? `${base}/@${this.plugin.settings.apiUsername}`
        : `${base}/@${this.plugin.settings.apiUsername}/${resolved}`;
    }
  }

  viewLiveVersion(file) {
    const activeFile = file || this.app.workspace.getActiveFile();
    if (!activeFile) {
      new obsidian_1.Notice("Standard: No active note.");
      return;
    }
    const url = this.getLiveUrl(activeFile);

    if (this.plugin.settings.openInObsidianWeb) {
      // Tenter d'ouvrir dans un volet séparé en utilisant le visionneur web natif d'Obsidian
      const leaf = this.app.workspace.getLeaf("split", "vertical");
      leaf.setViewState({
        type: "webviewer",
        state: { url: url },
      });
    } else {
      window.open(url, "_blank");
    }
  }

  async uploadContentImages(content, sourceFile, isBulk = false) {
    if (!this.plugin.settings.apiKey) return content;

    const uploaded = new Map();

    const uploadVaultFile = async (vaultFile) => {
      if (uploaded.has(vaultFile.path)) return uploaded.get(vaultFile.path);

      if (isBulk) {
        // Wait 2 seconds between image uploads/checks to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      try {
        const binary = await this.app.vault.readBinary(vaultFile);

        // Calculer le hash SHA-256 du contenu
        const hashBuffer = await crypto.subtle.digest("SHA-256", binary);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const contentHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

        const ext = vaultFile.name.split(".").pop()?.toLowerCase() || "bin";

        // Vérification préalable : voir si le serveur a déjà cette pièce jointe (déduplication)
        const checkUrl = `${this.plugin.settings.apiUrl}/publish/attachment?hash=${contentHash}&ext=${ext}`;
        const checkRes = await fetchWithRetry(checkUrl, {
          method: "GET",
          headers: { "x-api-key": this.plugin.settings.apiKey },
        });

        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.exists && checkData.url) {
            const cdnUrl = new URL(checkData.url, this.plugin.settings.apiUrl).href;
            uploaded.set(vaultFile.path, cdnUrl);
            return cdnUrl;
          }
        }

        // Sinon, procéder à l'envoi
        const blob = new Blob([binary], { type: getMimeType(vaultFile.name) });
        const form = new FormData();
        form.append("file", blob, vaultFile.name);

        const res = await fetchWithRetry(
          `${this.plugin.settings.apiUrl}/publish/attachment`,
          {
            method: "POST",
            headers: { "x-api-key": this.plugin.settings.apiKey },
            body: form,
          },
        );

        if (!res.ok) {
          console.warn(
            `Standard: Failed to upload ${vaultFile.name}`,
            res.status,
          );
          return null;
        }

        const data = await res.json();
        const cdnUrl = new URL(data.url, this.plugin.settings.apiUrl).href;
        uploaded.set(vaultFile.path, cdnUrl);
        return cdnUrl;
      } catch (err) {
        console.warn(`Standard: Error uploading ${vaultFile.name}`, err);
        return null;
      }
    };

    let result = content;

    const wikilinkRe = /!\[\[([^\]]+)\]\]/g;
    for (const match of [...result.matchAll(wikilinkRe)]) {
      const inner = match[1];
      const linktext = inner.split("|")[0].trim();
      if (!isImageFile(linktext)) continue;

      const vaultFile = this.app.metadataCache.getFirstLinkpathDest(
        linktext,
        sourceFile.path,
      );
      if (!vaultFile) continue;

      const cdnUrl = await uploadVaultFile(vaultFile);
      if (!cdnUrl) continue;

      const alt = inner.includes("|")
        ? inner.split("|")[1]
        : vaultFile.basename;
      result = result.replace(match[0], `![${alt}](${cdnUrl})`);
    }

    const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    for (const match of [...result.matchAll(mdImageRe)]) {
      const src = match[2];
      if (/^https?:\/\//.test(src)) continue;
      if (!isImageFile(src)) continue;

      const decoded = decodeURIComponent(src);
      const vaultFile =
        this.app.vault.getFileByPath(decoded) ||
        this.app.metadataCache.getFirstLinkpathDest(decoded, sourceFile.path);
      if (!vaultFile) continue;

      const cdnUrl = await uploadVaultFile(vaultFile);
      if (!cdnUrl) continue;

      result = result.replace(match[0], `![${match[1]}](${cdnUrl})`);
    }

    return result;
  }

  async publishNote(file, isBulk = false, preCalculatedContent = null) {
    try {
      const content = preCalculatedContent !== null ? preCalculatedContent : await this.uploadContentImages(await this.app.vault.read(file), file, isBulk);
      const slug = file.basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const response = await fetchWithRetry(
        `${this.plugin.settings.apiUrl}/publish/${slug}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.plugin.settings.apiKey,
          },
          body: JSON.stringify({
            title: file.basename,
            content,
            slug,
          }),
        },
      );
      if (!response.ok) {
        console.error(
          `Standard: Publish failed for ${file.basename}:`,
          response.status,
          await response.text(),
        );
        return false;
      }

      // Mettre à jour le frontmatter avec la propriété garden_url finale
      const liveUrl = this.getLiveUrl(file);

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        delete fm.published; // Nettoyer les anciennes clés obsolètes
        delete fm.url_public;
        fm.garden_url = liveUrl;
      });

      return true;
    } catch (error) {
      console.error(`Standard: Publish error for ${file.basename}:`, error);
      return false;
    }
  }

  async unpublishNote(file) {
    try {
      // Résoudre le slug de la même façon que la publication : permalink > slug > basename
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const fmSlug = fm.permalink ?? fm.slug;
      const basenameSlug = file.basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const resolved =
        fmSlug != null ? String(fmSlug).replace(/^\/+|\/+$/g, "") : basenameSlug;
      // La note racine résout en "" — non envoyable en segment d'URL, mappé à "~root"
      const slug = resolved === "" ? "~root" : resolved;
      const response = await fetchWithRetry(
        `${this.plugin.settings.apiUrl}/publish/${encodeURIComponent(slug)}`,
        {
          method: "DELETE",
          headers: {
            "x-api-key": this.plugin.settings.apiKey,
          },
        },
      );
      if (!response.ok) {
        console.error(
          `Standard: Unpublish failed for ${file.basename}:`,
          response.status,
        );
        return false;
      }

      // Mettre à jour le frontmatter en passant publish à false et en retirant garden_url
      const publishKey =
        (this.plugin.settings.keyPrefix || "") +
        this.plugin.settings.publishKey;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[publishKey] = false;
        delete fm.published;
        delete fm.url_public;
        delete fm.garden_url;
      });

      return true;
    } catch (error) {
      console.error(`Standard: Unpublish error for ${file.basename}:`, error);
      return false;
    }
  }

  // ── AI Token Generation ─────────────────────────────────────────────────────

  async generateTokens(instruction, noteContent, currentFm) {
    const apiKey = this.plugin.settings.apiKey;
    if (!apiKey) {
      throw new Error("Connect your Standard Garden account in settings first.");
    }

    const currentTokens = Object.fromEntries(
      Object.entries(currentFm).filter(([k]) => KNOWN_TOKENS.has(k)),
    );

    const response = await fetch(`${this.plugin.settings.apiUrl}/ai/theme`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ instruction, noteContent, currentTokens }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Standard API ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (!data.tokens) throw new Error("No tokens returned from AI service");
    return data.tokens;
  }

  // ── Publish with frontmatter check ────────────────────────────────────────
  // Returns true (success), false (API error), or null (user cancelled modal).

  async publishWithCheck(file) {
    if (!this.checkApiKeyAndShowModal()) {
      return null;
    }
    const meta = this.app.metadataCache.getFileCache(file);
    const fm = meta?.frontmatter || {};
    const publishKey =
      (this.plugin.settings.keyPrefix || "") + this.plugin.settings.publishKey;
    const publishValue = fm[publishKey];

    const doPublish = async () => {
      // Marquer publish: true pour que la clé de synchronisation soit correcte
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[publishKey] = true;
      });
      const ok = await this.publishNote(file);
      return ok;
    };

    // Guardrails — gather any reason this note might surprise you, then ask
    // once before planting it anyway.
    const warnings = [];
    if (publishValue === false || publishValue === "false") {
      warnings.push(`• ${publishKey}: false — it asked to stay a draft`);
    }
    if (String(fm.visibility || "").toLowerCase() === "private") {
      warnings.push(`• visibility: private — visitors won't see it`);
    }

    if (warnings.length > 0) {
      return new Promise((resolve) => {
        new StndConfirmModal(
          this.app,
          `🌱 Plant "${file.basename}" in the garden anyway?\n\n${warnings.join("\n")}`,
          "Plant it",
          async () => resolve(await doPublish()),
          () => resolve(null),
        ).open();
      });
    }

    // No key set, or already true → publish (and stamp key if missing)
    return await doPublish();
  }

  // ── Delete online version ─────────────────────────────────────────────────
  // Asks for confirmation, calls DELETE API, then updates frontmatter.
  // Returns true (deleted), false (API error), or null (user cancelled).

  async checkNoteStatus(file) {
    if (!this.plugin.settings.apiKey) {
      return { status: "unpublished" };
    }

    try {
      // 1. Résoudre le slug de la note locale
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const fmSlug = fm.permalink ?? fm.slug;
      const basenameSlug = file.basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const resolved =
        fmSlug != null ? String(fmSlug).replace(/^\/+|\/+$/g, "") : basenameSlug;
      const slug = resolved === "" ? "~root" : resolved;

      // 2. Récupérer le statut de la note distante
      const response = await fetch(`${this.plugin.settings.apiUrl}/publish/${encodeURIComponent(slug)}`, {
        method: "GET",
        headers: {
          "x-api-key": this.plugin.settings.apiKey,
        },
      });

      if (response.status === 404) {
        return { status: "unpublished" };
      }

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const remoteData = await response.json();
      const remoteContent = remoteData.content || "";
      const remoteHash = remoteData.hash;
      const remoteMtime = remoteData.updated_at ? new Date(remoteData.updated_at).getTime() : 0;

      // 3. Lire et normaliser le contenu local
      const localRawContent = await this.app.vault.read(file);
      
      const normalizeForHash = (content) => {
        if (!content) return "";
        let normalized = content.replace(/\r\n/g, "\n");
        
        // Normaliser les wikilinks ![[image.png|alt]] -> [IMAGE:alt_or_name]
        normalized = normalized.replace(/!\[\[([^\]]+)\]\]/g, (match, p1) => {
          const parts = p1.split("|");
          const name = parts[0].trim();
          const alt = parts[1] ? parts[1].trim() : "";
          if (alt) {
            return `[IMAGE:${alt.toLowerCase()}]`;
          }
          const baseName = name.substring(0, name.lastIndexOf('.')) || name;
          return `[IMAGE:${baseName.toLowerCase()}]`;
        });

        // Normaliser les images markdown ![alt](url) -> [IMAGE:alt_or_name]
        normalized = normalized.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
          const display = alt.trim();
          if (display) {
            return `[IMAGE:${display.toLowerCase()}]`;
          }
          const filename = url.split("/").pop() || "";
          const baseName = filename.substring(0, filename.lastIndexOf('.')) || filename;
          return `[IMAGE:${baseName.toLowerCase()}]`;
        });

        return normalized.trim();
      };

      const localNormalized = normalizeForHash(localRawContent);
      const remoteNormalized = normalizeForHash(remoteContent);

      // Calculer le hash du contenu normalisé local
      const msgUint8 = new TextEncoder().encode(localNormalized);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const localHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      if (remoteHash === localHash) {
        return { status: "synced" };
      }

      // Comparer les timestamps
      const localMtime = file.stat.mtime;
      if (remoteMtime > localMtime + 5000) {
        return { status: "outdated", remoteContent };
      } else {
        return { status: "changed" };
      }
    } catch (err) {
      console.error("Standard : Erreur lors de la vérification du statut de la note :", err);
      return { status: "error" };
    }
  }

  async deleteOnlineVersion(file) {
    if (!this.checkApiKeyAndShowModal()) {
      return null;
    }
    return new Promise((resolve) => {
      new StndConfirmModal(
        this.app,
        `Remove "${file.basename}" from Standard Garden?\n\nThe online version will be permanently deleted.`,
        "Delete online version",
        async () => {
          const ok = await this.unpublishNote(file);
          resolve(ok);
        },
        () => resolve(null),
      ).open();
    });
  }
}

module.exports = { GardenFeature };
