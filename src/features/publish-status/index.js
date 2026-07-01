"use strict";

const obsidian_1 = require("obsidian");

// ─── Publish Status ───────────────────────────────────────────────────────────
// A live "magic" status icon/button in Obsidian.
// The icon + colour reflect the note's garden state — not-published / public /
// unlisted / private — and update on the fly as the frontmatter changes.
// Location is configurable: titlebar (default), statusbar, ribbon, or hidden.

const STATES = {
  unpublished: { icon: "cloud-off",          color: "var(--text-faint)",  label: "Non publié" },
  pending:     { icon: "upload-cloud",       color: "var(--color-orange)", label: "À publier (pas encore en ligne)" },
  public:      { icon: "globe",              color: "var(--color-green)",  label: "Public" },
  unlisted:    { icon: "eye-off",            color: "var(--color-yellow)", label: "Non listé" },
  private:     { icon: "lock",               color: "var(--color-blue)",   label: "Privé" },
  outdated:    { icon: "arrow-down-circle",  color: "var(--color-orange)", label: "Mise à jour disponible en ligne" },
  changed:     { icon: "upload-cloud",       color: "var(--color-blue)",   label: "Modifications locales non publiées" },
};

class PublishStatusFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.statusBarEl = null;
    this.ribbonEl = null;
    this.noteStatuses = new Map(); // path -> { status, remoteContent, timestamp }
  }

  async load() {
    const refresh = () => this.refreshAll();
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.plugin.registerEvent(this.app.workspace.on("layout-change", refresh));
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.refreshForFile(file)),
    );
    this.app.workspace.onLayoutReady(refresh);
  }

  async unload() {
    this.cleanupAll();
  }

  cleanupAll() {
    // 1. Nettoyer les boutons de titre
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const el = leaf.view && leaf.view._stndPublishAction;
      if (el) {
        el.remove();
        delete leaf.view._stndPublishAction;
      }
    });

    // 2. Nettoyer la barre d'état
    if (this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }

    // 3. Nettoyer l'icône de ruban
    if (this.ribbonEl) {
      this.ribbonEl.remove();
      this.ribbonEl = null;
    }
  }

  // ── State ────────────────────────────────────────────────────────────────────
  // Distinguishes INTENT (`publish: true`) from REALITY (the plugin stamps
  // `garden_url` only on confirmed publish — its presence IS "actually live").
  stateKey(frontmatter, path) {
    const fm = frontmatter || {};
    const publishKey =
      (this.plugin.settings.keyPrefix || "") + this.plugin.settings.publishKey;
    const pub = fm[publishKey];
    const wantsPublish =
      pub === true ||
      pub === "true" ||
      pub === "public" ||
      pub === "unlisted" ||
      pub === "private";
    if (!wantsPublish) return "unpublished";
    if (!fm.garden_url && !fm.url_public) return "pending";

    // Si on a un statut en cache indiquant une désynchronisation, on l'affiche en priorité
    if (path && this.noteStatuses) {
      const cached = this.noteStatuses.get(path);
      if (cached && (cached.status === "outdated" || cached.status === "changed")) {
        return cached.status;
      }
    }

    const vis = String(fm.visibility || pub || "")
      .toLowerCase()
      .trim();
    if (vis === "private") return "private";
    if (vis === "unlisted") return "unlisted";
    return "public";
  }

  // ── Async Status Check ───────────────────────────────────────────────────────
  async triggerStatusCheck(file) {
    if (!file) return;
    const hasKey = !!this.plugin.settings.apiKey;
    if (!hasKey) return;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const publishKey = (this.plugin.settings.keyPrefix || "") + this.plugin.settings.publishKey;
    const pub = fm[publishKey];
    const wantsPublish =
      pub === true ||
      pub === "true" ||
      pub === "public" ||
      pub === "unlisted" ||
      pub === "private";
    const hasGardenUrl = fm.garden_url != null || fm.url_public != null;

    if (!wantsPublish || !hasGardenUrl) {
      this.noteStatuses.delete(file.path);
      return;
    }

    const cached = this.noteStatuses.get(file.path);
    const now = Date.now();

    // Skip check if verified recently and the file mtime hasn't changed since then
    if (cached && (now - cached.timestamp < 10000) && (file.stat.mtime <= cached.timestamp)) {
      return;
    }

    // Block concurrent checks by setting an intermediate timestamp
    this.noteStatuses.set(file.path, {
      status: cached ? cached.status : this.stateKey(fm, file.path),
      remoteContent: cached ? cached.remoteContent : null,
      timestamp: now
    });

    const garden = this.plugin.garden;
    if (!garden) return;

    try {
      const res = await garden.checkNoteStatus(file);
      this.noteStatuses.set(file.path, {
        status: res.status,
        remoteContent: res.remoteContent,
        timestamp: Date.now()
      });
      this.refreshAll();
    } catch (err) {
      console.error("Standard : Erreur lors de la vérification asynchrone du statut :", err);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  refreshAll() {
    const hasKey = !!this.plugin.settings.apiKey;
    const location = this.plugin.settings.publishStatusLocation || "titlebar";

    if (!hasKey || location === "hidden") {
      this.cleanupAll();
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.triggerStatusCheck(activeFile);
    }

    // Nettoyer les autres widgets inutilisés pour l'emplacement actuel
    if (location !== "titlebar") {
      this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
        const el = leaf.view && leaf.view._stndPublishAction;
        if (el) {
          el.remove();
          delete leaf.view._stndPublishAction;
        }
      });
    }

    if (location !== "statusbar" && this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }

    if (location !== "ribbon" && this.ribbonEl) {
      this.ribbonEl.remove();
      this.ribbonEl = null;
    }

    // Mettre à jour ou créer le widget de l'emplacement actif
    if (location === "titlebar") {
      this.app.workspace
        .getLeavesOfType("markdown")
        .forEach((leaf) => this.refreshLeaf(leaf));
    } else if (location === "statusbar") {
      this.refreshStatusBar();
    } else if (location === "ribbon") {
      this.refreshRibbon();
    }
  }

  refreshForFile(file) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === file.path) {
      this.refreshAll();
    } else if (this.plugin.settings.publishStatusLocation === "titlebar") {
      this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
        if (leaf.view && leaf.view.file && leaf.view.file.path === file.path) {
          this.refreshLeaf(leaf);
        }
      });
    }
  }

  refreshLeaf(leaf) {
    const view = leaf.view;
    if (!view || typeof view.addAction !== "function" || !view.file) return;

    const fm =
      this.app.metadataCache.getFileCache(view.file)?.frontmatter || null;
    const key = this.stateKey(fm, view.file.path);
    const state = STATES[key];

    let el = view._stndPublishAction;
    if (!el || !el.isConnected) {
      el = view.addAction(state.icon, "Garden Status", (evt) => this.onClick(view, evt));
      el.addClass("stnd-publish-status");
      view._stndPublishAction = el;
    }
    obsidian_1.setIcon(el, state.icon);
    el.style.color = state.color;
    el.setAttribute("aria-label", `Garden Status — ${state.label}`);
    el.dataset.stndState = key;
  }

  refreshStatusBar() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      if (this.statusBarEl) this.statusBarEl.style.display = "none";
      return;
    }

    const fm = this.app.metadataCache.getFileCache(activeFile)?.frontmatter || null;
    const key = this.stateKey(fm, activeFile.path);
    const state = STATES[key];

    if (!this.statusBarEl) {
      this.statusBarEl = this.plugin.addStatusBarItem();
      this.statusBarEl.addClass("stnd-publish-status-statusbar");
      this.statusBarEl.style.cursor = "pointer";
      this.statusBarEl.addEventListener("click", (evt) => {
        const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        if (view) this.onClick(view, evt);
      });
    }

    this.statusBarEl.style.display = "";
    this.statusBarEl.empty();
    
    const iconSpan = this.statusBarEl.createSpan();
    obsidian_1.setIcon(iconSpan, state.icon);
    iconSpan.style.color = state.color;
    iconSpan.style.marginRight = "6px";
    iconSpan.style.display = "inline-flex";
    iconSpan.style.alignItems = "center";

    this.statusBarEl.createSpan({ text: `Garden: ${state.label}` });
    this.statusBarEl.setAttribute("aria-label", `Garden Status — ${state.label}`);
  }

  refreshRibbon() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      if (this.ribbonEl) this.ribbonEl.style.display = "none";
      return;
    }

    const fm = this.app.metadataCache.getFileCache(activeFile)?.frontmatter || null;
    const key = this.stateKey(fm, activeFile.path);
    const state = STATES[key];

    if (!this.ribbonEl) {
      this.ribbonEl = this.plugin.addRibbonIcon(state.icon, "Garden Status", (evt) => {
        const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        if (view) this.onClick(view, evt);
      });
      this.ribbonEl.addClass("stnd-publish-status-ribbon");
    }

    this.ribbonEl.style.display = "";
    obsidian_1.setIcon(this.ribbonEl, state.icon);
    this.ribbonEl.style.color = state.color;
    this.ribbonEl.setAttribute("aria-label", `Garden Status — ${state.label}`);
  }

  // ── Click → contextual menu ──────────────────────────────────────────────────
  onClick(view, evt) {
    const file = view.file;
    if (!file) return;
    const garden = this.plugin.garden;
    if (!garden) return;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || null;
    const key = this.stateKey(fm, file.path);
    const menu = new obsidian_1.Menu();

    const publish = async () => {
      if (!garden.checkApiKeyAndShowModal()) {
        return;
      }
      const ok = await garden.publishWithCheck(file);
      if (ok !== null) {
        new obsidian_1.Notice(
          ok
            ? `Standard : "${file.basename}" publié.`
            : `Standard : Échec de la publication de "${file.basename}".`,
        );
      }
      this.refreshAll();
    };

    if (key === "unpublished" || key === "pending") {
      menu.addItem((i) =>
        i.setTitle("Publier dans le jardin").setIcon("upload-cloud").onClick(() => publish()),
      );
    } else if (key === "outdated") {
      const cached = this.noteStatuses.get(file.path);
      const remoteContent = cached?.remoteContent || "";
      menu.addItem((i) =>
        i
          .setTitle("Télécharger la mise à jour (écraser le fichier local)")
          .setIcon("arrow-down-circle")
          .onClick(async () => {
            if (remoteContent) {
              await this.app.vault.modify(file, remoteContent);
              new obsidian_1.Notice(`Standard : Fichier local mis à jour avec la version en ligne.`);
              this.noteStatuses.set(file.path, {
                status: "synced",
                timestamp: Date.now()
              });
              this.refreshAll();
            } else {
              new obsidian_1.Notice(`Standard : Contenu distant introuvable.`);
            }
          }),
      );
      menu.addItem((i) =>
        i.setTitle("Forcer la publication locale").setIcon("refresh-cw").onClick(() => publish()),
      );
      menu.addItem((i) =>
        i.setTitle("Voir en ligne").setIcon("external-link").onClick(() => garden.viewLiveVersion(file)),
      );
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Retirer du jardin (dé-publier)")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(async () => {
            await garden.deleteOnlineVersion(file);
            this.refreshAll();
          }),
      );
    } else if (key === "changed") {
      menu.addItem((i) =>
        i.setTitle("Publier les modifications locales").setIcon("upload-cloud").onClick(() => publish()),
      );
      menu.addItem((i) =>
        i.setTitle("Voir en ligne").setIcon("external-link").onClick(() => garden.viewLiveVersion(file)),
      );
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Retirer du jardin (dé-publier)")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(async () => {
            await garden.deleteOnlineVersion(file);
            this.refreshAll();
          }),
      );
    } else {
      menu.addItem((i) =>
        i.setTitle("Voir en ligne").setIcon("external-link").onClick(() => garden.viewLiveVersion(file)),
      );
      menu.addItem((i) =>
        i.setTitle("Re-publier").setIcon("refresh-cw").onClick(() => publish()),
      );
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Retirer du jardin (dé-publier)")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(async () => {
            await garden.deleteOnlineVersion(file);
            this.refreshAll();
          }),
      );
    }

    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Synchroniser toutes les notes")
        .setIcon("folder-sync")
        .onClick(() => garden.syncAllPublished()),
    );
    menu.showAtMouseEvent(evt);
  }
}

module.exports = { PublishStatusFeature };
