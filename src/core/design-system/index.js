"use strict";

const obsidian_1 = require("obsidian");
const { KNOWN_TOKENS, FONT_TOKENS } = require("../../constants");
// Curated theme token blocks ({ name: "[data-stnd-theme=…]{…}" }), bundled into
// main.js by build.js. Only the active theme's block is injected at runtime, so
// the style engine never parses the other ~33 unused [data-stnd-theme] blocks.
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
    this.appliedSnippetViewClasses = new Set();
    this.hasAppliedStartupSnapshot = false;
    this.stndFrontmatterElement = null;
    this.stndThemeElement = null;
    this.lastAppliedCustomCss = "";
    this.lastAppliedThemeSnippetCss = "";
    this.lastAppliedThemePath = "";
    this.lastAppliedThemeMtime = 0;
    this.frontmatterUpdateTimeout = null;
    this.snapshotSaveTimeout = null;
    this.workspaceReadyTimeout = null;
    this.startupRetryCount = 0;
    this.themeCache = {};
  }

  async load() {
    await this.loadThemeCacheFromFile();
    this.ensureThemeElement();

    // ─── Syntax highlighting post-processor ──────────────────────────────────
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
        if (code.querySelector(".token")) {
          code.classList.add("is-highlighted");
          return;
        }
        const match = code.className.match(/language-(\S+)/);
        if (!match) return;
        const grammar = Prism.languages[match[1]];
        if (grammar) {
          try {
            code.innerHTML = Prism.highlight(code.textContent, grammar, match[1]);
            code.classList.add("is-highlighted");
          } catch (e) {
          }
        }
      });
    });

    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateBodyClasses();
        this.updateModeClasses();
      }),
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        clearTimeout(this.frontmatterUpdateTimeout);
        this.frontmatterUpdateTimeout = setTimeout(() => {
          this.updateBodyClasses();
        }, 50);
      }),
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on("resolve", (file) => {
        if (!this.hasAppliedStartupSnapshot)
          this.applyStartupSnapshotSynchronously();
        clearTimeout(this.frontmatterUpdateTimeout);
        this.frontmatterUpdateTimeout = setTimeout(() => {
          this.updateBodyClasses();
        }, 50);
      }),
    );
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.updateModeClasses();
      }),
    );
    this.plugin.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && info.file === activeFile) {
          clearTimeout(this.frontmatterUpdateTimeout);
          this.frontmatterUpdateTimeout = setTimeout(() => {
            this.updateBodyClasses();
          }, 50);
        }
      }),
    );
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        clearTimeout(this.frontmatterUpdateTimeout);
        this.frontmatterUpdateTimeout = setTimeout(() => {
          this.updateBodyClasses();
        }, 50);
      }),
    );

    this.updateModeClasses();

    if (this.app?.workspace?.onLayoutReady) {
      this.app.workspace.onLayoutReady(() => {
        this.onWorkspaceReady();
      });
    } else {
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
    document.body.removeAttribute("data-stnd-theme");
    if (this.stndThemeElement) {
      this.stndThemeElement.remove();
    }
    this.cleanup();
    this.clearModeClasses();
  }

  onWorkspaceReady() {
    this.workspaceReadyTimeout = setTimeout(() => {
      this.updateBodyClasses();
      this.applyStartupSnapshotSynchronously();
    }, 50);
  }

  // Single <style> for the entire theme: curated token block + theme note CSS.
  // Always re-appended to end of <head> so it sits before #stnd-frontmatter
  // in the cascade (frontmatter is the per-note escape hatch → last).
  ensureThemeElement() {
    let el = document.getElementById("stnd-theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "stnd-theme";
      document.head.appendChild(el);
    }
    this.stndThemeElement = el;
  }

  // Build the combined CSS: curated token block first, then theme note CSS.
  // Only touches textContent (never moves the element) to avoid style recalc flicker.
  applyThemeCss(theme, snippetCss) {
    if (!this.stndThemeElement) return;
    let tokenBlock = (theme && THEMES[theme]) || "";
    // Normalize bundled selectors: [data-theme="..."] → [data-stnd-theme="..."]
    if (tokenBlock) {
      tokenBlock = tokenBlock.replace(/\[data-theme="/g, '[data-stnd-theme="');
    }
    const combined = [tokenBlock, snippetCss].filter(Boolean).join("\n\n");
    if (this.stndThemeElement.textContent !== combined) {
      this.stndThemeElement.textContent = combined;
    }
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

  createStyleElements() {
    // Create both elements in the correct cascade order (theme before frontmatter).
    // Once created, they are never moved — only their textContent changes.
    this.ensureThemeElement();

    let element = document.getElementById("stnd-frontmatter");
    if (!element) {
      element = document.createElement("style");
      element.id = "stnd-frontmatter";
      // Insert AFTER #stnd-theme so frontmatter always wins the cascade
      if (this.stndThemeElement && this.stndThemeElement.nextSibling) {
        document.head.insertBefore(element, this.stndThemeElement.nextSibling);
      } else {
        document.head.appendChild(element);
      }
    }
    this.stndFrontmatterElement = element;
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
    }, 1000);
  }

  async updateBodyClasses() {
    const activeFile = this.app.workspace.getActiveFile();

    const newClasses = new Set();
    let frontmatter = null;

    if (this.plugin.settings.enableDesignSystem) {
      newClasses.add("stnd-adapter");
    }

    if (activeFile) {
      frontmatter =
        this.app.metadataCache.getFileCache(activeFile)?.frontmatter ?? null;

      if (frontmatter) {
        const cssclasses = frontmatter.cssclasses || frontmatter.cssClasses;
        if (cssclasses) {
          const list = Array.isArray(cssclasses) ? cssclasses : [cssclasses];
          list.forEach((cls) => {
            if (typeof cls === "string" && cls.trim().length > 0) {
              newClasses.add("cssclass-" + cls.trim().replace(/\s+/g, "-"));
            }
          });
        }

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

    const bodyClassList = document.body.classList;

    this.appliedClasses.forEach((cls) => {
      if (!newClasses.has(cls)) {
        bodyClassList.remove(cls);
      }
    });

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

    if (this.plugin.settings.enableDesignSystem) {
      if (!activeFile) {
        // No active file (settings modal, empty workspace) — leave as-is
      } else if (frontmatter) {
        this.applyFrontmatter(frontmatter);
        await this.applyTheme(frontmatter);
      } else {
        // File is active but frontmatter not resolved yet — apply theme with
        // empty string so curated tokens still load if data-stnd-theme is set
        await this.applyTheme(null);
      }
    } else {
      this.clearFrontmatterProperties();
      this.clearThemeSnippet();
      document.body.removeAttribute("data-stnd-theme");
      this.applyThemeCss(null, "");
    }

    this.saveStartupSnapshot(newClasses, frontmatter);
  }

  // theme: frontmatter → data-stnd-theme on body + combined CSS injection.
  async applyTheme(frontmatter) {
    const theme =
      frontmatter && frontmatter.theme != null
        ? String(frontmatter.theme).trim()
        : "";

    if (theme) {
      document.body.setAttribute("data-stnd-theme", theme);
    } else {
      document.body.removeAttribute("data-stnd-theme");
    }

    if (!theme) {
      this.clearThemeSnippet();
      this.applyThemeCss(null, "");
      return;
    }

    // Zero-latency cache injection
    const rawCachedCss = this.themeCache[theme];
    if (rawCachedCss) {
      const cachedCss = rawCachedCss.replace(/body\.stnd-color\b/g, `[data-stnd-theme="${theme}"]`);
      this.lastAppliedThemeSnippetCss = cachedCss;
      this.applyThemeCss(theme, cachedCss);
    } else {
      if (this.lastAppliedThemeSnippetCss) {
        this.clearThemeSnippet();
      }
      // Still apply curated tokens immediately (bundled, no I/O)
      this.applyThemeCss(theme, "");
    }

    const themeNote = this.app.metadataCache.getFirstLinkpathDest(theme, "");
    if (!themeNote) {
      if (!cachedCss) this.clearThemeSnippet();
      return;
    }

    if (
      this.lastAppliedThemePath === themeNote.path &&
      this.lastAppliedThemeMtime === themeNote.stat.mtime
    ) {
      return;
    }

    try {
      const content = await this.app.vault.read(themeNote);
      const regex = /```css\b.*?\n([\s\S]*?)```/gi;
      let allCss = [...content.matchAll(regex)].map((m) => m[1]).join("\n");
      // Normalize stale selectors from older vault notes / adapter output
      allCss = allCss.replace(/body\.stnd-color\b/g, `[data-stnd-theme="${theme}"]`);

      if (allCss !== this.lastAppliedThemeSnippetCss) {
        this.lastAppliedThemeSnippetCss = allCss;
        this.lastAppliedThemePath = themeNote.path;
        this.lastAppliedThemeMtime = themeNote.stat.mtime;

        this.applyThemeCss(theme, allCss);

        this.themeCache[theme] = allCss;
        const cachedThemes = Object.keys(this.themeCache);
        if (cachedThemes.length > 5) {
          delete this.themeCache[cachedThemes[0]];
        }
        await this.saveThemeCacheToFile();
      } else {
        this.lastAppliedThemePath = themeNote.path;
        this.lastAppliedThemeMtime = themeNote.stat.mtime;
      }
    } catch (e) {
      console.error(
        `Standard: Error loading theme note "${themeNote.path}":`,
        e,
      );
      if (!cachedCss) this.clearThemeSnippet();
    }
  }

  clearThemeSnippet() {
    this.lastAppliedThemeSnippetCss = "";
    this.lastAppliedThemePath = "";
    this.lastAppliedThemeMtime = 0;
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

    if (Array.isArray(snap.cssClasses)) {
      snap.cssClasses.forEach((cls) => {
        if (typeof cls === "string" && cls.trim().length > 0) {
          const className = "cssclass-" + cls.trim();
          document.body.classList.add(className);
          this.appliedClasses.add(className);
        }
      });
    }

    if (this.plugin.settings.enableDesignSystem) {
      document.body.classList.add("stnd-adapter");
      this.appliedClasses.add("stnd-adapter");
    }

    if (this.plugin.settings.enableDesignSystem) {
      if (snap.theme) {
        document.body.setAttribute("data-stnd-theme", snap.theme);
      }
      this.createStyleElements();

      // Inject the combined theme (curated tokens + cached snippet) into #stnd-theme
      let snippetCss = (snap.theme && this.themeCache[snap.theme]) || "";
      if (snippetCss) {
        snippetCss = snippetCss.replace(/body\.stnd-color\b/g, `[data-stnd-theme="${snap.theme}"]`);
      }
      this.applyThemeCss(snap.theme, snippetCss);
      this.lastAppliedThemeSnippetCss = snippetCss;

      if (snap.customCss && this.stndFrontmatterElement) {
        this.stndFrontmatterElement.textContent = snap.customCss;
        this.lastAppliedCustomCss = snap.customCss;
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
      if (
        !this.stndFrontmatterElement ||
        !document.getElementById("stnd-frontmatter")
      ) {
        this.stndFrontmatterElement = document.createElement("style");
        this.stndFrontmatterElement.id = "stnd-frontmatter";
        // Insert after #stnd-theme so frontmatter wins the cascade
        const themeEl = document.getElementById("stnd-theme");
        if (themeEl && themeEl.nextSibling) {
          document.head.insertBefore(this.stndFrontmatterElement, themeEl.nextSibling);
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
        return;
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
