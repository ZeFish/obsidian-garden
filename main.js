"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");

const { DEFAULT_SETTINGS } = require("./src/constants");

// ─── Plugin (orchestrator) ─────────────────────────────────────────────────────
// Loads the core modules (design-system, garden) and the feature modules, then
// wires the user-facing surfaces — side panel, settings tab, ribbon icons, and
// commands — delegating the work to the modules that own it. All theming lives in
// `this.design`; all publish/AI lives in `this.garden`.

class StandardPlugin extends obsidian_1.Plugin {
  constructor() {
    super(...arguments);
    this.features = [];
  }

  async onload() {
    const start = performance.now();
    document.body.classList.add("stnd");

    // Sync Obsidian's theme class to standard's data-theme attribute
    const syncTheme = () => {
      const isDark = document.body.classList.contains("theme-dark");
      document.body.setAttribute("data-theme", isDark ? "dark" : "light");
    };
    syncTheme();
    this.themeObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "class") syncTheme();
      }
    });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // ─── Phase 1: Minimal Data Load ──────────────────────────────────────────
    // loadData() is the primary bottleneck if data.json is large.
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    // ─── Phase 2: Critical Visual Path ───────────────────────────────────────
    // Only load what's needed for the immediate theme and CSS injection.
    const {
      DesignSystemFeature,
    } = require("./src/core/design-system/index.js");
    const {
      SnippetManagerFeature,
    } = require("./src/features/snippet-manager/index.js");

    this.features = [];

    if (this.settings.enableDesignSystem) {
      this.design = new DesignSystemFeature(this.app, this);
      this.features.push(this.design);
    }
    
    if (this.settings.enableSnippets) {
      this.snippetManager = new SnippetManagerFeature(this.app, this);
      this.features.push(this.snippetManager);
    }

    // Load visual features in parallel
    await Promise.all(this.features.map(f => f.load()));

    // Inject the last session's visual state (classes, theme, tokens)
    // synchronously so the UI is themed before the first render. Runs after the
    // visual features are loaded so stnd-theme-snippet is appended after stnd-global.
    if (this.design) {
      this.design.applyStartupSnapshotSynchronously();
    }

    // ─── Phase 3: Deferred Registration ──────────────────────────────────────
    // Everything else (functional features, icons, commands) is deferred to
    // onLayoutReady. This unblocks the Obsidian loader almost immediately.
    this.app.workspace.onLayoutReady(() => {
      this.loadRemainingFeatures(start);
    });
  }

  async loadRemainingFeatures(startTime) {
    // Lazy-require functional features to avoid execution cost during Phase 1/2
    const { GardenFeature } = require("./src/core/garden/index.js");
    const { HotFolderFeature } = require("./src/features/hot-folder/index.js");
    const {
      InterfaceManagerFeature,
    } = require("./src/features/interface-manager/index.js");
    const {
      LinkAssistFeature,
    } = require("./src/features/link-assist/index.js");

    const { ScrollMapFeature } = require("./src/features/scroll-map/index.js");
    const {
      Base64FoldFeature,
    } = require("./src/features/base64-fold/index.js");
    const {
      PublishStatusFeature,
    } = require("./src/features/publish-status/index.js");
    const {
      VaultAuditFeature,
    } = require("./src/features/vault-audit/index.js");
    const {
      SyntaxPreviewFeature,
    } = require("./src/features/syntax-preview/index.js");
    const { DailyNavFeature } = require("./src/features/daily-nav/index.js");

    this.garden = new GardenFeature(this.app, this);
    this.features.push(this.garden);

    // Account linking: the /connect-obsidian web page hands the API key back via
    // obsidian://standard-connect?key=…&username=…&state=… (see Garden.startConnect).
    this.registerObsidianProtocolHandler("standard-connect", (params) => {
      this.garden.handleConnectCallback(params);
    });

    const functionalInstances = [];
    functionalInstances.push(new InterfaceManagerFeature(this.app, this));
    functionalInstances.push(new PublishStatusFeature(this.app, this));
    functionalInstances.push(new VaultAuditFeature(this.app, this));

    if (this.settings.enableLinkAssist) {
      this.linkAssist = new LinkAssistFeature(this.app, this);
      functionalInstances.push(this.linkAssist);
    }
    if (this.settings.enableHotFolder) {
      functionalInstances.push(new HotFolderFeature(this.app, this));
    }
    if (this.settings.enableScrollMap) {
      functionalInstances.push(new ScrollMapFeature(this.app, this));
    }
    if (this.settings.enableBase64Fold) {
      functionalInstances.push(new Base64FoldFeature(this.app, this));
    }
    if (this.settings.enableSyntaxPreview) {
      functionalInstances.push(new SyntaxPreviewFeature(this.app, this));
    }
    if (this.settings.enableDailyNav) {
      functionalInstances.push(new DailyNavFeature(this.app, this));
    }

    this.features.push(...functionalInstances);

    // Load functional features in parallel
    await Promise.all(
      functionalInstances.map((f) => (f.load ? f.load() : Promise.resolve())),
    );

    // Register side panel view
    const {
      StandardGardenView,
      STND_PANEL_VIEW,
    } = require("./src/ui/panel-view.js");
    this.registerView(
      STND_PANEL_VIEW,
      (leaf) => new StandardGardenView(leaf, this),
    );

    // Add settings tab
    const { StandardSettingTab } = require("./src/ui/settings-tab.js");
    this.settingTab = new StandardSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // ─── Ribbon icons ────────────────────────────────────────────────────────
    // Supprimé au profit du bouton contextuel de statut dans chaque note.

    // ─── Commands ────────────────────────────────────────────────────────────
    const { STND_PANEL_VIEW: PANEL_ID } = require("./src/ui/panel-view.js");
    this.addCommand({
      id: "open-stnd-panel",
      name: "Open Garden panel",
      callback: () => this.activatePanel(PANEL_ID),
    });
    this.addCommand({
      id: "publish-current-note",
      name: "Plant seed (Publish current note)",
      callback: () => this.garden.publishCurrentNote(),
    });
    this.addCommand({
      id: "unpublish-current-note",
      name: "Uproot seed (Remove from garden)",
      callback: () => this.garden.unpublishCurrentNote(),
    });
    this.addCommand({
      id: "view-live-version",
      name: "View live version",
      callback: () => this.garden.viewLiveVersion(),
    });
    this.addCommand({
      id: "sync-all-published",
      name: "Tend the garden (Sync all notes)",
      callback: () => this.garden.syncAllPublished(),
    });


    const end = performance.now();
    console.log(
      `[Standard] Fully loaded in ${Math.round(end - startTime)}ms (Visuals ready at ~150ms)`,
    );
  }

  async onunload() {
    for (const feature of this.features) {
      if (feature.unload) await feature.unload();
    }
    if (this.themeObserver) this.themeObserver.disconnect();
    document.body.classList.remove("stnd");
    const { STND_PANEL_VIEW } = require("./src/ui/panel-view.js");
    this.app.workspace.detachLeavesOfType(STND_PANEL_VIEW);
  }

  async activatePanel(viewId) {
    const { STND_PANEL_VIEW } = require("./src/ui/panel-view.js");
    const id = viewId || STND_PANEL_VIEW;
    const existing = this.app.workspace.getLeavesOfType(id);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: id, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  updateRibbonIconsVisibility() {
    // No-op depuis le nettoyage des icônes du ruban
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    // --- MIGRATION: Purge massive caches from data.json ---
    // We moved these to external files to keep startup instantaneous.
    let needsPurge = false;
    if (this.settings.themeCache) {
      delete this.settings.themeCache;
      needsPurge = true;
    }
    if (this.settings.snippets && this.settings.snippets.globalCache) {
      delete this.settings.snippets.globalCache;
      needsPurge = true;
    }
    if (needsPurge) {
      console.log("[Standard] Purging heavy caches from data.json...");
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }


}

module.exports = StandardPlugin;
