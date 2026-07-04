"use strict";

const { PluginSettingTab, Setting, Notice } = require("obsidian");
const { descWithLinks } = require("../../constants.js");


const DEFAULT_SETTINGS = {
  enabled: true,
  // Notes whose frontmatter has this key become vault-wide stylesheets.
  globalKey: "snippet",
  // CSS loaded from named notes while the matching note is open.
  localKey: "snippets",
  alwaysUseCssClasses: false,
  // Compiled CSS of all global snippets, persisted so it can be injected
  // synchronously at startup — eliminates the flash of unstyled content while
  // the vault loads and files are (re-)read.
  globalCache: "",
  // Signature (paths + mtimes) of the snippet set that produced globalCache.
  // Lets the background rescan skip re-reading files that haven't changed.
  globalSignature: "",
};

// ─── Snippet Manager ─────────────────────────────────────────────────────────
// Loads CSS from your notes — nothing else. It is deliberately UNAWARE of design
// tokens, themes, or any CSS framework: that is the Standard Garden plugin's
// department. Atelier only reads a `snippet:` (global) / `snippets:` (local)
// frontmatter key and injects the `​```css` blocks it finds.

class SnippetManagerFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    if (!plugin.settings.snippets)
      plugin.settings.snippets = { ...DEFAULT_SETTINGS };
    this.settings = plugin.settings.snippets;

    this.globalElement = null; // #stnd-global — vault-wide
    this.noteElement = null; // #stnd-note   — active note

    this.lastGlobalCss = null;
    this.lastLocalCss = null;
    this.rescanTimeout = null;
    this.saveTimeout = null;
  }

  async load() {
    // Self-contained: own both style elements (global ordered before local so
    // local snippets can override global ones).
    this.globalElement = this.ensureStyle("stnd-global");
    this.noteElement = this.ensureStyle("stnd-note");

    // --- OPTIMIZATION: Load cache from file instead of settings ---
    // This keeps data.json small and startup fast.
    if (this.settings.enabled) {
      this.loadCacheFromFile();
    }

    // Refresh local snippets for the changed file; schedule a global rescan.
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        // Refresh local snippets of active note regardless of which file changed
        // (the changed file might be a snippet listed in the active note).
        const active = this.app.workspace.getActiveFile();
        if (active) this.applyLocalForFile(active);

        this.scheduleGlobalRescan();
      }),
    );

    // Fast path for editing snippets
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        const active = this.app.workspace.getActiveFile();
        if (active) this.applyLocalForFile(active);
      }),
    );

    // Apply local snippets immediately on note switch (metadataCache "changed"
    // doesn't fire on plain open).
    this.plugin.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) this.applyLocalForFile(file);
      }),
    );

    // Once the vault is indexed, apply the current note and do an authoritative
    // global rescan to refresh the startup cache.
    this.app.workspace.onLayoutReady(() => {
      const active = this.app.workspace.getActiveFile();
      if (active) this.applyLocalForFile(active);
      this.scheduleGlobalRescan(300);
    });
  }

  getCachePath() {
    return `${this.plugin.manifest.dir}/cache-global.css`;
  }

  async loadCacheFromFile() {
    const path = this.getCachePath();
    const adapter = this.app.vault.adapter;
    try {
      if (await adapter.exists(path)) {
        const css = await adapter.read(path);
        if (css && this.globalElement) {
          // --- OPTIMIZATION: Resolve device-specific paths at runtime ---
          // The cache file uses stable placeholders so it works across Sync.
          const fontDir = `${this.plugin.manifest.dir}/fonts`;
          const resolvedCss = css.replace(
            /STND_FONT_URL:([\w.-]+)/g,
            (match, fileName) => {
              return adapter.getResourcePath(`${fontDir}/${fileName}`);
            },
          );
          this.globalElement.textContent = resolvedCss;
          this.lastGlobalCss = css; // Store the RAW css with placeholders for comparison
        }
      }
    } catch (e) {
      console.warn("[Standard] Failed to load snippet cache:", e);
    }
  }

  ensureStyle(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    return el;
  }

  async unload() {
    if (this.rescanTimeout) clearTimeout(this.rescanTimeout);
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.globalElement?.remove();
    this.noteElement?.remove();
    this.globalElement = null;
    this.noteElement = null;
  }

  fileHasGlobalKey(frontmatter) {
    return Boolean(frontmatter && frontmatter[this.settings.globalKey]);
  }

  // ─── Global (vault-wide) snippets ─────────────────────────────────────────

  scheduleGlobalRescan(delay = 1000) {
    if (this.rescanTimeout) clearTimeout(this.rescanTimeout);
    this.rescanTimeout = setTimeout(() => this.rescanGlobalSnippets(), delay);
  }

  async rescanGlobalSnippets() {
    if (!this.settings.enabled) {
      if (this.globalElement) this.globalElement.textContent = "";
      // Force a rebuild when re-enabled (the live element was just cleared).
      this.settings.globalSignature = "";
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    const globalFiles = files
      .filter((file) => {
        const meta = this.app.metadataCache.getFileCache(file);
        return this.fileHasGlobalKey(meta?.frontmatter);
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    // Skip the re-read when the snippet set is unchanged. The signature is built
    // from each file's path + mtime — both available on the TFile without any
    // I/O — so an unchanged vault costs zero file reads (the aggregated CSS was
    // already injected asynchronously from cache in load()).
    const signature = globalFiles
      .map((f) => `${f.path}:${f.stat?.mtime ?? 0}`)
      .join("|");
    if (signature === this.settings.globalSignature) return;

    let allCss = "";
    for (const file of globalFiles) {
      try {
        const css = await this.extractCssFromFile(file);
        if (css.trim()) allCss += css + "\n";
      } catch (e) {
        console.warn(`[Atelier] Error reading global snippet ${file.path}:`, e);
      }
    }

    this.settings.globalSignature = signature;
    if (allCss !== this.lastGlobalCss) {
      // --- OPTIMIZATION: Font Offloader (The "Sorcery") ---
      // Scans for massive base64 fonts, saves them as binary, and uses portable placeholders.
      const processedCss = await this.offloadFonts(allCss);

      // Only update DOM if the processed CSS (with placeholders) changed
      if (processedCss !== this.lastGlobalCss) {
        this.lastGlobalCss = processedCss;

        // Resolve placeholders for immediate application
        const adapter = this.app.vault.adapter;
        const fontDir = `${this.plugin.manifest.dir}/fonts`;
        const resolvedCss = processedCss.replace(
          /STND_FONT_URL:([\w.-]+)/g,
          (match, fileName) => {
            return adapter.getResourcePath(`${fontDir}/${fileName}`);
          },
        );

        if (this.globalElement) this.globalElement.textContent = resolvedCss;

        // Save RAW CSS with placeholders to external file
        try {
          await this.app.vault.adapter.write(this.getCachePath(), processedCss);
        } catch (e) {
          console.warn("[Standard] Failed to save snippet cache:", e);
        }
      }
    }
    this.debouncedSave();
  }

  async offloadFonts(css) {
    const fontDir = `${this.plugin.manifest.dir}/fonts`;
    const adapter = this.app.vault.adapter;

    try {
      if (!(await adapter.exists(fontDir))) {
        await adapter.mkdir(fontDir);
      }
    } catch (e) {
      console.error("[Standard] Failed to create font directory:", e);
      return css;
    }

    // Regex to find data:font URLs
    const dataUriRegex =
      /url\(['"]?data:(font\/[\w-]+);base64,([a-zA-Z0-9+/=]+)['"]?\)/gi;
    const matches = [...css.matchAll(dataUriRegex)];

    if (matches.length === 0) return css;

    // To prevent crashing mobile with 60MB of string manipulations:
    // 1. Collect all font data and their filenames
    const fontMap = new Map();
    for (const match of matches) {
      const [fullMatch, mimeType, base64Data] = match;
      if (!base64Data || base64Data.length < 100) continue;

      const extension = mimeType.split("/")[1] || "woff2";
      const hash = this.hashString(base64Data);
      const fileName = `font-${hash}.${extension}`;

      fontMap.set(fullMatch, fileName);
    }

    // 2. Save binary files (with yields to keep mobile alive)
    const uniqueFonts = [...new Set(fontMap.values())];
    let saved = 0;

    for (const fileName of uniqueFonts) {
      const filePath = `${fontDir}/${fileName}`;
      if (!(await adapter.exists(filePath))) {
        // Find the data for this filename
        const dataMatch = matches.find(
          (m) => this.hashString(m[2]) === fileName.split("-")[1].split(".")[0],
        );
        const data = dataMatch ? dataMatch[2] : null;

        if (data) {
          try {
            const binaryString = atob(data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
            await adapter.writeBinary(filePath, bytes.buffer);
            saved++;

            // Yield every 5 fonts to keep UI responsive
            if (saved % 5 === 0) await new Promise((r) => setTimeout(r, 0));
          } catch (e) {
            console.warn(`[Standard] Failed to save font ${fileName}:`, e);
          }
        }
      }
    }

    if (saved > 0) console.log(`[Standard] Cached ${saved} new binary fonts.`);

    // 3. Single-pass replacement using the map (efficient)
    return css.replace(dataUriRegex, (match) => {
      const fileName = fontMap.get(match);
      return fileName ? `url("STND_FONT_URL:${fileName}")` : match;
    });
  }

  hashString(str) {
    // Simple fast hash for filename stability (synchronous)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  debouncedSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.plugin.saveSettings(), 500);
  }

  // ─── Local (active-note) snippets ─────────────────────────────────────────

  updateLocalForFile(file) {
    const active = this.app.workspace.getActiveFile();
    if (active && active.path === file.path) this.applyLocalForFile(file);
  }

  applyLocalForFile(file) {
    const meta = this.app.metadataCache.getFileCache(file);
    this.updateLocalSnippets(meta?.frontmatter);
  }

  async updateLocalSnippets(frontmatter) {
    if (!this.settings.enabled || !frontmatter) {
      this.clearLocalSnippet();
      return;
    }

    let names = [];
    const keys = [this.settings.localKey];
    if (
      this.settings.alwaysUseCssClasses &&
      this.settings.localKey !== "cssclasses"
    ) {
      keys.push("cssclasses");
    }
    for (const key of keys) {
      const prop = frontmatter[key];
      if (typeof prop === "string" && prop.trim()) {
        names.push(prop.trim());
      } else if (Array.isArray(prop)) {
        names = names.concat(
          prop.filter((s) => typeof s === "string").map((s) => s.trim()),
        );
      }
    }
    names = [...new Set(names)].filter(Boolean);

    if (names.length === 0) {
      this.clearLocalSnippet();
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    let allCss = "";
    for (const name of names) {
      const file = files.find((f) => f.basename === name);
      if (file) allCss += (await this.extractCssFromFile(file)) + "\n";
    }

    if (allCss !== this.lastLocalCss) {
      this.lastLocalCss = allCss;
      if (this.noteElement)
        this.noteElement.textContent = allCss.trim() ? allCss : "";
    }
  }

  clearLocalSnippet() {
    this.lastLocalCss = null;
    if (this.noteElement) this.noteElement.textContent = "";
  }

  async extractCssFromFile(file) {
    const content = await this.app.vault.read(file);
    // Improved regex: handles trailing spaces, optional carriage returns, and multiple blocks
    const regex = /```css\b.*?\n([\s\S]*?)```/gi;
    return [...content.matchAll(regex)].map((m) => m[1]).join("\n");
  }
}

class SnippetManagerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    if (!this.plugin.settings.snippets)
      this.plugin.settings.snippets = { ...DEFAULT_SETTINGS };
    this.settings = this.plugin.settings.snippets;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Snippet Manager" });
    const desc = containerEl.createEl("p", {
      text: "Snippet Manager compiles and registers CSS stylesheets written directly inside your markdown notes. It parses CSS code blocks and hot-loads them in real time, bypassing Obsidian's hidden snippets directory. ",
      cls: "setting-item-description",
    });
    desc.createEl("a", {
      text: "View Snippet Manager Manual",
      href: "https://stnd.build/3-archives/obsidian-plugin#4-snippet-manager",
    });

    const enableSetting = new Setting(containerEl)
      .setName("Enable snippets")
      .setDesc(descWithLinks(
        "Master switch for compilation and injection of § into your workspace.",
        [{ text: "note-based CSS stylesheets", href: "https://stnd.build/3-archives/obsidian-plugin#4-snippet-manager" }]
      ));
    enableSetting.addToggle((toggle) =>
      toggle.setValue(this.settings.enabled).onChange(async (v) => {
        this.settings.enabled = v;
        await this.plugin.saveSettings();
        if (v) {
          const feature = this.getFeature();
          if (feature) {
            feature.lastGlobalCss = null;
            feature.settings.globalSignature = "";
            // Run in background without awaiting to keep UI responsive
            feature.rescanGlobalSnippets().then(() => {
              new Notice("Garden: Snippets loaded ✓");
            });
            // Load active file local snippet
            const active = this.app.workspace.getActiveFile();
            if (active) feature.applyLocalForFile(active);
          }
        } else {
          this.refreshFeature();
          new Notice("Garden: Snippets disabled");
        }
      }),
    );

    const globalKeySetting = new Setting(containerEl)
      .setName("Global snippet key")
      .setDesc(descWithLinks(
        "YAML key identifying notes that serve as vault-wide stylesheets (e.g. `snippet: true`). These styles are § to prevent a flash of unstyled content at startup.",
        [{ text: "cached locally", href: "https://stnd.build/3-archives/obsidian-plugin#4-snippet-manager" }]
      ));
    globalKeySetting.addText((text) =>
      text.setValue(this.settings.globalKey).onChange(async (v) => {
        this.settings.globalKey = v.trim() || "snippet";
        await this.plugin.saveSettings();
        this.refreshFeature();
      }),
    );

    const localKeySetting = new Setting(containerEl)
      .setName("Local snippet key")
      .setDesc(descWithLinks(
        "YAML key listing note names whose CSS loads only while that note is active (e.g. `snippets: [layout-card]`). § for contextual style patterns.",
        [{ text: "See local snippets guide", href: "https://stnd.build/3-archives/obsidian-plugin#4-snippet-manager" }]
      ));
    localKeySetting.addText((text) =>
      text.setValue(this.settings.localKey).onChange(async (v) => {
        this.settings.localKey = v.trim() || "snippets";
        await this.plugin.saveSettings();
        this.refreshFeature();
      }),
    );

    const cssClassesSetting = new Setting(containerEl)
      .setName("Always use 'cssclasses'")
      .setDesc(descWithLinks(
        "Scan the native Obsidian § property for matching note stylesheets to load contextually.",
        [{ text: "cssclasses", href: "https://stnd.build/3-archives/obsidian-plugin#4-snippet-manager" }]
      ));
    cssClassesSetting.addToggle((toggle) =>
      toggle
        .setValue(this.settings.alwaysUseCssClasses || false)
        .onChange(async (v) => {
          this.settings.alwaysUseCssClasses = v;
          await this.plugin.saveSettings();
          this.refreshFeature();
        }),
    );

    const rebuildSetting = new Setting(containerEl)
      .setName("Rebuild global cache")
      .setDesc(descWithLinks(
        "Force a full rescan of all global snippet notes and rebuild the startup cache file. § if styles aren't loading.",
        [{ text: "Troubleshoot cache issues", href: "https://stnd.build/3-archives/obsidian-plugin#4-snippet-manager" }]
      ));
    rebuildSetting.addButton((btn) =>
      btn.setButtonText("Rebuild now").onClick(async () => {
        const feature = this.getFeature();
        if (feature) {
          feature.lastGlobalCss = null;
          feature.settings.globalCache = ""; // Force clear settings
          feature.settings.globalSignature = ""; // Bypass the unchanged-skip
          await feature.rescanGlobalSnippets();
          new Notice("Global snippet cache rebuilt.");
        }
      }),
    );
  }

  getFeature() {
    return this.plugin.features.find((f) => f instanceof SnippetManagerFeature);
  }

  refreshFeature() {
    const feature = this.getFeature();
    if (feature) {
      feature.rescanGlobalSnippets();
      const active = this.app.workspace.getActiveFile();
      if (active) feature.applyLocalForFile(active);
    }
  }
}

module.exports = { SnippetManagerFeature, SnippetManagerSettingTab };
