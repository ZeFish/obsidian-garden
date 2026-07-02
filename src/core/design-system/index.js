"use strict";

const obsidian_1 = require("obsidian");
const { KNOWN_TOKENS, FONT_TOKENS } = require("../../constants");
// Curated theme token blocks ({ name: "[data-theme=…]{…}" }), bundled into
// main.js by build.js. Only the active theme's block is injected at runtime, so
// the style engine never parses the other ~33 unused [data-theme] blocks.
const THEMES = require("../../themes.generated.js");

// Helper to bundle and load common PrismJS languages since Obsidian bundles a bare-minimum Prism instance
function loadCommonPrismLanguages(Prism) {
  const oldPrism = window.Prism;
  window.Prism = Prism;
  try {
    if (!Prism.languages.css) {
      require("prismjs/components/prism-css");
    }
    if (!Prism.languages.typescript) {
      require("prismjs/components/prism-typescript");
    }
    if (!Prism.languages.json) {
      require("prismjs/components/prism-json");
    }
    if (!Prism.languages.yaml) {
      require("prismjs/components/prism-yaml");
    }
    if (!Prism.languages.bash) {
      require("prismjs/components/prism-bash");
    }
  } catch (e) {
    console.error("[Standard] Failed to load bundled Prism languages:", e);
  } finally {
    if (oldPrism) window.Prism = oldPrism;
  }
}

class DesignSystemFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;

    this.appliedClasses = new Set();
    this.appliedSnippetViewClasses = new Set(); // view-mode classes (stnd-reading, …)
    this.hasAppliedStartupSnapshot = false;
    this.stndFrontmatterElement = null;
    this.stndThemeSnippetElement = null;
    this.stndThemeTokensElement = null;
    this.lastAppliedCustomCss = "";
    this.lastAppliedThemeSnippetCss = "";
    this.lastAppliedThemePath = "";
    this.lastAppliedThemeMtime = 0;
    this.frontmatterUpdateTimeout = null;
    this.snapshotSaveTimeout = null;
    this.workspaceReadyTimeout = null;
    this.startupRetryCount = 0;
    this.themeCache = {}; // Local memory cache, persisted to cache-themes.json
  }

  async load() {
    // --- OPTIMIZATION: Load theme cache from file ---
    await this.loadThemeCacheFromFile();

    // Curated-theme tokens get their own <style>. Created first — before
    // snippet-manager's #stnd-global — so the cascade matches the old layout
    // (curated tokens < global snippets < frontmatter !important overrides),
    // where the themes used to live at the top of styles.css.
    this.ensureThemeTokensElement();

    // ─── Syntax highlighting post-processor ──────────────────────────────────
    // Obsidian loads PrismJS (and its grammars) lazily and asynchronously. The
    // bare `window.Prism` global can be reached before that finishes, so reading
    // `Prism.languages[lang]` synchronously returns undefined for blocks rendered
    // early — even for core languages like css — leaving them untokenized (no
    // .token spans → color.css has nothing to paint). `loadPrism()` resolves only
    // once Prism is fully initialised, so the grammars exist by the time we
    // tokenize. We also re-run manually because Obsidian skips its own pass when
    // another processor (e.g. Templater) has already claimed the block.
    this.plugin.registerMarkdownPostProcessor(async (el) => {
      const codes = el.querySelectorAll(
        'pre > code[class*="language-"]:not(.is-highlighted)',
      );
      if (!codes.length) return;
      let Prism;
      try {
        Prism = await obsidian_1.loadPrism();
      } catch (e) {
        return;
      }
      if (!Prism || typeof Prism.highlight !== "function") return;
      loadCommonPrismLanguages(Prism);
      codes.forEach((code) => {
        // If the code block is already highlighted (has token spans), don't touch it!
        if (code.querySelector(".token")) {
          code.classList.add("is-highlighted");
          return;
        }

        // Extract language from class e.g. "language-json is-loaded" → "json"
        const match = code.className.match(/language-(\S+)/);
        if (!match) return;
        const grammar = Prism.languages[match[1]];
        if (grammar) {
          try {
            code.innerHTML = Prism.highlight(code.textContent, grammar, match[1]);
            code.classList.add("is-highlighted");
          } catch (e) {
            // Leave the block untouched if Prism throws on its content.
          }
        }
      });
    });

    // Update classes when active note changes
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateBodyClasses();
        this.updateModeClasses();
      }),
    );
    // Update classes when frontmatter changes
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        // Run update on any markdown change to ensure theme notes trigger updates
        // on the notes that use them. applyTheme is optimized to skip injection
        // if the CSS content hasn't changed.
        clearTimeout(this.frontmatterUpdateTimeout);
        this.frontmatterUpdateTimeout = setTimeout(() => {
          this.updateBodyClasses();
        }, 50);
      }),
    );

    // Also listen for frontmatter resolve events. On a cold start the vault
    // fires "resolve" once per file as it indexes (hundreds of times); applying
    // the snapshot stays immediate, but updateBodyClasses is debounced so the
    // indexing storm collapses into a single pass instead of one per file.
    this.plugin.registerEvent(
      this.app.metadataCache.on("resolve", (file) => {
        // Try applying startup snapshot if still idle and not yet applied
        if (!this.hasAppliedStartupSnapshot)
          this.applyStartupSnapshotSynchronously();
        clearTimeout(this.frontmatterUpdateTimeout);
        this.frontmatterUpdateTimeout = setTimeout(() => {
          this.updateBodyClasses();
        }, 50);
      }),
    );

    // Update classes when mode changes
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.updateModeClasses();
      }),
    );

    // Add more immediate response to editor changes
    this.plugin.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && info.file === activeFile) {
          // Debounce the update to avoid excessive calls
          clearTimeout(this.frontmatterUpdateTimeout);
          this.frontmatterUpdateTimeout = setTimeout(() => {
            this.updateBodyClasses();
          }, 50);
        }
      }),
    );

    // Listen for file modifications (immediate response)
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        // Run update on any markdown change to ensure theme notes trigger updates
        // on the notes that use them.
        clearTimeout(this.frontmatterUpdateTimeout);
        this.frontmatterUpdateTimeout = setTimeout(() => {
          this.updateBodyClasses();
        }, 50);
      }),
    );

    this.updateModeClasses();

    // Also attempt once the workspace layout is ready
    // (ensures vault files are available)
    if (this.app?.workspace?.onLayoutReady) {
      this.app.workspace.onLayoutReady(() => {
        this.onWorkspaceReady();
      });
    } else {
      // Fallback for older Obsidian versions
      this.app.workspace.on("layout-ready", () => {
        this.onWorkspaceReady();
      });
    }
  }

  async unload() {
    if (this.frontmatterUpdateTimeout)
      clearTimeout(this.frontmatterUpdateTimeout);
    if (this.workspaceReadyTimeout) clearTimeout(this.workspaceReadyTimeout);
    if (this.snapshotSaveTimeout) clearTimeout(this.snapshotSaveTimeout);
    document.body.removeAttribute("data-theme");
    if (this.stndThemeSnippetElement) {
      this.stndThemeSnippetElement.remove();
    }
    if (this.stndThemeTokensElement) {
      this.stndThemeTokensElement.remove();
    }
    this.cleanup();
    this.clearModeClasses();
  }

  onWorkspaceReady() {
    // Re-sync body classes once the workspace (and vault files) are available —
    // the load call fires too early.
    this.workspaceReadyTimeout = setTimeout(() => {
      this.updateBodyClasses();
      this.applyStartupSnapshotSynchronously();
    }, 50);
  }

  ensureThemeTokensElement() {
    let el = document.getElementById("stnd-theme-tokens");
    if (!el) {
      el = document.createElement("style");
      el.id = "stnd-theme-tokens";
      document.head.appendChild(el);
    }
    this.stndThemeTokensElement = el;
  }

  async loadThemeCacheFromFile() {
    const path = `${this.plugin.manifest.dir}/cache-themes.json`;
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const json = await this.app.vault.adapter.read(path);
        this.themeCache = JSON.parse(json) || {};
      }
    } catch (e) {
      console.warn("[Standard] Failed to load theme cache:", e);
    }
  }

  async saveThemeCacheToFile() {
    const path = `${this.plugin.manifest.dir}/cache-themes.json`;
    try {
      await this.app.vault.adapter.write(
        path,
        JSON.stringify(this.themeCache, null, 2),
      );
    } catch (e) {
      console.warn("[Standard] Failed to save theme cache:", e);
    }
  }

  // Inject the active curated theme's token block (or clear it). Only one theme
  // is ever in the DOM; an unknown name (e.g. a vault theme note) injects
  // nothing here and is handled by the theme-snippet path instead.
  applyThemeTokens(theme) {
    if (!this.stndThemeTokensElement) return;
    const css = (theme && THEMES[theme]) || "";
    if (this.stndThemeTokensElement.textContent !== css) {
      this.stndThemeTokensElement.textContent = css;
    }
  }

  createStyleElements() {
    let element = document.getElementById("stnd-frontmatter");
    if (!element) {
      element = document.createElement("style");
      element.id = "stnd-frontmatter";
      document.head.appendChild(element);
    }
    this.stndFrontmatterElement = element;

    let themeElement = document.getElementById("stnd-theme-snippet");
    if (!themeElement) {
      themeElement = document.createElement("style");
      themeElement.id = "stnd-theme-snippet";
      document.head.appendChild(themeElement);
    }
    this.stndThemeSnippetElement = themeElement;
  }

  cleanup() {
    this.clearAllClasses();
    this.clearSnippetViewClasses();
    this.clearFrontmatterProperties();
    this.clearThemeSnippet();
  }

  saveStartupSnapshot(classes, frontmatter) {
    clearTimeout(this.snapshotSaveTimeout);
    this.snapshotSaveTimeout = setTimeout(async () => {
      const theme =
        frontmatter && frontmatter.theme != null
          ? String(frontmatter.theme).trim()
          : "";

      this.plugin.settings.startupSnapshot = {
        cssClasses: Array.from(classes).map((c) => c.replace("cssclass-", "")),
        theme: theme,
        customCss: this.lastAppliedCustomCss,
      };
      await this.plugin.saveSettings();
    }, 1000); // Debounce by 1s to avoid excessive writes
  }

  // Called on every leaf-change, editor-change, metadata-change, etc.
  async updateBodyClasses() {
    const activeFile = this.app.workspace.getActiveFile();

    const newClasses = new Set();
    let frontmatter = null;

    // 1. Global settings
    if (this.plugin.settings.enableDesignSystem) {
      newClasses.add("stnd-adapter");
    }

    // 2. Per-note frontmatter
    if (activeFile) {
      // Use Obsidian's metadata cache as the sole source of truth for
      // frontmatter so body classes stay stable while editing.
      frontmatter =
        this.app.metadataCache.getFileCache(activeFile)?.frontmatter ?? null;

      if (frontmatter) {
        // cssclasses
        const cssclasses = frontmatter.cssclasses || frontmatter.cssClasses;
        if (cssclasses) {
          const list = Array.isArray(cssclasses) ? cssclasses : [cssclasses];
          list.forEach((cls) => {
            if (typeof cls === "string" && cls.trim().length > 0) {
              newClasses.add("cssclass-" + cls.trim().replace(/\s+/g, "-"));
            }
          });
        }

        // published + visibility — use the configurable publish key (default: "publish")
        const publishKey =
          (this.plugin.settings.keyPrefix || "") +
          this.plugin.settings.publishKey;
        const pub = frontmatter[publishKey];
        const isPublished =
          pub === true ||
          pub === "true" ||
          pub === "public" ||
          pub === "unlisted" ||
          pub === "private";

        if (isPublished) {
          newClasses.add("stnd-note-published");

          const vis = String(frontmatter.visibility || pub || "")
            .toLowerCase()
            .trim();

          if (vis === "public") {
            newClasses.add("stnd-note-public");
          } else if (vis === "unlisted") {
            newClasses.add("stnd-note-unlisted");
          } else if (vis === "private") {
            newClasses.add("stnd-note-private");
          }
        }
      }
    }

    // 3. Diff and Apply classes
    const bodyClassList = document.body.classList;

    // Remove classes that are no longer present
    this.appliedClasses.forEach((cls) => {
      if (!newClasses.has(cls)) {
        bodyClassList.remove(cls);
      }
    });

    // Add new classes
    newClasses.forEach((cls) => {
      if (!this.appliedClasses.has(cls)) {
        try {
          bodyClassList.add(cls);
        } catch (e) {
          if (e instanceof DOMException) {
            new obsidian_1.Notice(
              `Stnd: Invalid CSS class found: "${cls}". Check your frontmatter for classes with spaces or special characters.`,
            );
          } else {
            throw e;
          }
        }
      }
    });

    this.appliedClasses = newClasses;

    // 4. Design-token properties from frontmatter
    // 5. Theme selection (theme: frontmatter → data-theme on body)
    if (this.plugin.settings.enableDesignSystem) {
      if (activeFile && frontmatter) {
        this.applyFrontmatter(frontmatter);
      } else {
        this.clearFrontmatterProperties();
      }
      await this.applyTheme(frontmatter);
    } else {
      this.clearFrontmatterProperties();
      this.clearThemeSnippet();
      document.body.removeAttribute("data-theme");
      this.applyThemeTokens(null);
    }

    // Save snapshot for next startup
    this.saveStartupSnapshot(newClasses, frontmatter);
  }

  // theme: frontmatter selects a bundled curated theme (data-theme on body).
  // Also searches for a matching .md file in the vault to inject CSS snippets.
  async applyTheme(frontmatter) {
    const theme =
      frontmatter && frontmatter.theme != null
        ? String(frontmatter.theme).trim()
        : "";

    // 1. Set the data-theme attribute + inject the curated token block
    if (theme) {
      document.body.setAttribute("data-theme", theme);
    } else {
      document.body.removeAttribute("data-theme");
    }
    this.applyThemeTokens(theme);

    // 2. Load and inject CSS from the theme note
    if (!theme) {
      this.clearThemeSnippet();
      return;
    }

    // --- OPTIMIZATION: Zero-latency cache injection ---
    // If we have a cached version of this theme's CSS, apply it synchronously
    // to prevent the flash of unstyled content while we wait for the vault read.
    const cachedCss = this.themeCache[theme];
    if (cachedCss && this.stndThemeSnippetElement) {
      this.stndThemeSnippetElement.textContent = cachedCss;
      document.head.appendChild(this.stndThemeSnippetElement);
      this.lastAppliedThemeSnippetCss = cachedCss;
    } else {
      // If not in cache and not the currently applied CSS, clear to avoid
      // showing the previous theme's snippet on the new theme's attribute.
      if (this.lastAppliedThemeSnippetCss) {
        this.clearThemeSnippet();
      }
    }

    const themeNote = this.app.metadataCache.getFirstLinkpathDest(theme, "");
    if (!themeNote) {
      // If we applied from cache but the file is gone, clear it
      if (!cachedCss) this.clearThemeSnippet();
      return;
    }

    // --- OPTIMIZATION: Skip re-read if file is unchanged ---
    if (
      this.lastAppliedThemePath === themeNote.path &&
      this.lastAppliedThemeMtime === themeNote.stat.mtime
    ) {
      return;
    }

    try {
      const content = await this.app.vault.read(themeNote);
      // Improved regex: handles trailing spaces, optional carriage returns, and multiple blocks
      const regex = /```css\b.*?\n([\s\S]*?)```/gi;
      const allCss = [...content.matchAll(regex)].map((m) => m[1]).join("\n");

      if (allCss !== this.lastAppliedThemeSnippetCss) {
        if (this.stndThemeSnippetElement) {
          this.stndThemeSnippetElement.textContent = allCss;
          document.head.appendChild(this.stndThemeSnippetElement);
        }
        this.lastAppliedThemeSnippetCss = allCss;
        this.lastAppliedThemePath = themeNote.path;
        this.lastAppliedThemeMtime = themeNote.stat.mtime;

        // Update local cache and persist to file (keep data.json lean)
        this.themeCache[theme] = allCss;

        const cachedThemes = Object.keys(this.themeCache);
        if (cachedThemes.length > 5) {
          delete this.themeCache[cachedThemes[0]];
        }

        await this.saveThemeCacheToFile();
      } else {
        // If content is same but mtime changed (e.g. non-CSS edit), still update trackers
        this.lastAppliedThemePath = themeNote.path;
        this.lastAppliedThemeMtime = themeNote.stat.mtime;
      }
    } catch (e) {
      console.error(
        `Standard: Error loading theme note "${themeNote.path}":`,
        e,
      );
      // Don't clear if we have a cache — it might just be a transient read error
      if (!cachedCss) this.clearThemeSnippet();
    }
  }

  clearThemeSnippet() {
    this.lastAppliedThemeSnippetCss = "";
    this.lastAppliedThemePath = "";
    this.lastAppliedThemeMtime = 0;
    if (this.stndThemeSnippetElement) {
      this.stndThemeSnippetElement.textContent = "";
    }
  }

  clearAllClasses() {
    this.appliedClasses.forEach((className) => {
      document.body.classList.remove(className);
    });
    this.appliedClasses.clear();
  }

  clearSnippetViewClasses() {
    if (
      !this.appliedSnippetViewClasses ||
      this.appliedSnippetViewClasses.size === 0
    )
      return;
    const activeLeaf = document.querySelector(
      ".mod-root .workspace-leaf.mod-active .workspace-leaf-content",
    );
    if (!activeLeaf) {
      this.appliedSnippetViewClasses.clear();
      return;
    }
    const viewEls = activeLeaf.querySelectorAll(
      ".markdown-source-view, .markdown-preview-view",
    );
    this.appliedSnippetViewClasses.forEach((cls) => {
      viewEls.forEach((el) => el.classList.remove(cls));
    });
    this.appliedSnippetViewClasses.clear();
  }

  addClassToViews(className) {
    const activeLeaf = document.querySelector(
      ".mod-root .workspace-leaf.mod-active .workspace-leaf-content",
    );
    if (!activeLeaf) return;
    const viewEls = activeLeaf.querySelectorAll(
      ".markdown-source-view, .markdown-preview-view",
    );
    viewEls.forEach((el) => el.classList.add(className));
    this.appliedSnippetViewClasses.add(className);
  }

  applyStartupSnapshotSynchronously() {
    if (this.hasAppliedStartupSnapshot) return;

    const snap = this.plugin.settings?.startupSnapshot;
    if (!snap) {
      this.hasAppliedStartupSnapshot = true;
      return;
    }

    // 1. Apply body classes
    if (Array.isArray(snap.cssClasses)) {
      snap.cssClasses.forEach((cls) => {
        if (typeof cls === "string" && cls.trim().length > 0) {
          const className = "cssclass-" + cls.trim();
          document.body.classList.add(className);
          this.appliedClasses.add(className);
        }
      });
    }

    // 2. Apply global settings classes
    if (this.plugin.settings.enableDesignSystem) {
      document.body.classList.add("stnd-adapter");
      this.appliedClasses.add("stnd-adapter");
    }

    // 3. Apply active theme + design tokens (only when design system is enabled)
    if (this.plugin.settings.enableDesignSystem) {
      if (snap.theme) {
        document.body.setAttribute("data-theme", snap.theme);
      }
      this.applyThemeTokens(snap.theme);

      this.createStyleElements();

      if (snap.customCss && this.stndFrontmatterElement) {
        this.stndFrontmatterElement.textContent = snap.customCss;
        this.lastAppliedCustomCss = snap.customCss;
      }

      if (snap.theme && this.themeCache[snap.theme]) {
        const themeCss = this.themeCache[snap.theme];
        if (this.stndThemeSnippetElement) {
          this.stndThemeSnippetElement.textContent = themeCss;
          document.head.appendChild(this.stndThemeSnippetElement);
          this.lastAppliedThemeSnippetCss = themeCss;
        }
      }
    } else {
      this.createStyleElements();
    }

    this.hasAppliedStartupSnapshot = true;
  }

  clearModeViewClasses() {
    const activeLeaf = document.querySelector(
      ".mod-root .workspace-leaf.mod-active .workspace-leaf-content",
    );
    if (!activeLeaf) return;
    const viewEls = activeLeaf.querySelectorAll(
      ".markdown-source-view, .markdown-preview-view",
    );
    const modeClasses = [
      "stnd-reading",
      "stnd-editing",
      "stnd-source",
      "stnd-canvas",
      "stnd-empty",
      "stnd-base",
      "stnd-webviewer",
      "stnd-note",
    ];
    modeClasses.forEach((className) => {
      viewEls.forEach((el) => el.classList.remove(className));
      if (this.appliedSnippetViewClasses) {
        this.appliedSnippetViewClasses.delete(className);
      }
    });
  }

  applyFrontmatter(frontmatter) {
    const stndProps = {};
    const fontProperties = new Set();

    for (const [key, value] of Object.entries(frontmatter)) {
      if (KNOWN_TOKENS.has(key)) {
        const cssVarName = "--" + key;
        stndProps[cssVarName] = value;
        if (FONT_TOKENS.has(key)) {
          const fontNames = String(value)
            .split(",")
            .map((font) => font.trim().replace(/['"]/g, ""));
          fontNames.forEach((font) => fontProperties.add(font));
        }
      }
    }

    if (Object.keys(stndProps).length > 0) {
      // Ensure the element exists
      if (
        !this.stndFrontmatterElement ||
        !document.getElementById("stnd-frontmatter")
      ) {
        this.stndFrontmatterElement = document.createElement("style");
        this.stndFrontmatterElement.id = "stnd-frontmatter";
        const themeEl = document.getElementById("stnd-theme-snippet");
        if (themeEl) {
          document.head.insertBefore(this.stndFrontmatterElement, themeEl);
        } else {
          document.head.appendChild(this.stndFrontmatterElement);
        }
      }
      let stndFrontmatterElement = this.stndFrontmatterElement;
      const googleFontsImports = Array.from(fontProperties)
        .map((font) => {
          const fontUrl = font.replace(/\s+/g, "+");
          return `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}&display=swap');`;
        })
        .join("\n");
      const cssVars = Object.entries(stndProps)
        .map(([prop, value]) => {
          const key = prop.slice(2);
          const shouldQuote =
            FONT_TOKENS.has(key) &&
            typeof value === "string" &&
            value.includes(" ") &&
            !value.startsWith("'") &&
            !value.startsWith('"');
          const formattedValue = shouldQuote ? "'" + value + "'" : value;
          return `  ${prop}: ${formattedValue} !important;`;
        })
        .join("\n");
      const newCssContent = [googleFontsImports, `html body {\n${cssVars}\n}`]
        .filter(Boolean)
        .join("\n\n");

      if (newCssContent === this.lastAppliedCustomCss) {
        return; // No change, so no DOM update needed
      }

      stndFrontmatterElement.textContent = newCssContent;
      this.lastAppliedCustomCss = newCssContent;
    } else {
      this.clearFrontmatterProperties();
    }
  }

  clearFrontmatterProperties() {
    if (this.stndFrontmatterElement) {
      this.stndFrontmatterElement.textContent = "";
      this.lastAppliedCustomCss = "";
    }
  }

  updateModeClasses() {
    const body = document.body;
    const leafContentEl = document.querySelector(
      ".mod-root .workspace-leaf.mod-active .workspace-leaf-content",
    );
    if (!leafContentEl) return;

    // `layout-change` fires continuously while scrolling (editor reflow, viewport
    // changes — see scroll-map). Re-clearing and re-adding the mode classes,
    // including `stnd-reading` on the `.markdown-preview-view`, forces a full
    // style recalc of the note subtree on every scroll frame — felt as janky /
    // "jumping" scroll, worst on mobile. Skip when nothing that affects these
    // classes has actually changed (same leaf, same mode, same live-preview).
    const dataType = leafContentEl.getAttribute("data-type");
    const dataMode = leafContentEl.getAttribute("data-mode");
    const sourceView = leafContentEl.querySelector(".markdown-source-view");
    const isLivePreview = sourceView
      ? sourceView.classList.contains("is-live-preview")
      : false;
    const modeSignature = `${dataType}|${dataMode}|${isLivePreview}`;
    if (
      leafContentEl === this._lastModeLeafEl &&
      modeSignature === this._lastModeSignature
    ) {
      return;
    }
    this._lastModeLeafEl = leafContentEl;
    this._lastModeSignature = modeSignature;

    this.clearModeClasses();
    this.clearModeViewClasses();

    let newMode = null;
    switch (dataType) {
      case "markdown":
        body.classList.add("stnd-note");
        this.addClassToViews("stnd-note");
        if (dataMode === "preview") {
          newMode = "reading";
          body.classList.add("stnd-reading");
          this.addClassToViews("stnd-reading");
        } else if (dataMode === "source") {
          newMode = "editing";
          body.classList.add("stnd-editing");
          this.addClassToViews("stnd-editing");
          // Raw Source vs Live Preview: Obsidian marks the editor
          // `.markdown-source-view` with `is-live-preview` only in Live
          // Preview, so its absence means raw source mode.
          if (sourceView && !isLivePreview) {
            body.classList.add("stnd-source");
            this.addClassToViews("stnd-source");
          }
        }
        break;
      case "canvas":
        newMode = "canvas";
        body.classList.add("stnd-canvas");
        this.addClassToViews("stnd-canvas");
        break;
      case "empty":
        newMode = "empty";
        body.classList.add("stnd-empty");
        this.addClassToViews("stnd-empty");
        break;
      case "webviewer":
        newMode = "webviewer";
        body.classList.add("stnd-webviewer");
        this.addClassToViews("stnd-webviewer");
        break;
      case "bases":
        newMode = "base";
        body.classList.add("stnd-base");
        this.addClassToViews("stnd-base");
        break;
    }
  }

  clearModeClasses() {
    const modeClasses = [
      "stnd-reading",
      "stnd-editing",
      "stnd-source",
      "stnd-canvas",
      "stnd-empty",
      "stnd-base",
      "stnd-webviewer",
      "stnd-note",
    ];
    modeClasses.forEach((className) => {
      document.body.classList.remove(className);
      this.appliedClasses.delete(className);
    });
  }
}

module.exports = { DesignSystemFeature };
