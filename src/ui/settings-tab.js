"use strict";

const obsidian_1 = require("obsidian");
const { descWithLinks } = require("../constants.js");


// Feature setting tabs
// (Echo, Hollow, Feed moved to the Atelier plugin — see apps/obsidian-atelier.)
const { HotFolderSettingTab } = require("../features/hot-folder/index.js");
const {
  InterfaceManagerSettingTab,
} = require("../features/interface-manager/index.js");
const { LinkAssistSettingTab } = require("../features/link-assist/index.js");
const { ScrollMapSettingTab } = require("../features/scroll-map/index.js");
const {
  SnippetManagerSettingTab,
} = require("../features/snippet-manager/index.js");
const { Base64FoldSettingTab } = require("../features/base64-fold/index.js");
const { SystemTraySettingTab } = require("../features/system-tray/index.js");
const { MediaManagerSettingTab } = require("../features/vault-audit/index.js");
const { DailyNavSettingTab } = require("../features/daily-nav/index.js");

class StandardSettingTab extends obsidian_1.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.currentTab = "Garden";
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    
    // Align starting height with Obsidian's search settings field
    containerEl.style.paddingTop = "32px";

    // Standard::Garden title
    const headerTitle = containerEl.createEl("h2", { text: "Standard::Garden" });
    headerTitle.style.cssText = "margin: 0 0 16px 0; font-size: var(--font-ui-large); font-weight: 600; text-align: left;";

    // 1. Render persistent header (identity card and stats) at the top if connected
    const hasHeader = !!this.plugin.settings.apiUsername;
    if (hasHeader) {
      this._renderPersistentHeader(containerEl);
      
      // Divider line between stats and tabs
      const divider = containerEl.createEl("hr", { cls: "stnd-settings-divider" });
      divider.style.cssText = "margin: 24px 0; border: 0; border-top: 1px solid var(--background-modifier-border);";
    }

    // 2. Flat Navigation Tabs (no groups)
    const navEl = containerEl.createEl("div", { cls: "stnd-settings-nav" });
    navEl.style.cssText = `display: flex; justify-content: flex-start; gap: 6px; flex-wrap: wrap; margin: ${hasHeader ? "0" : "12px"} 0 12px;`;

    const tabs = [
      { id: "Garden", tab: null },
      { id: "Hot Folder", tab: new HotFolderSettingTab(this.app, this.plugin) },
      { id: "General", tab: null },
      { id: "Themes", tab: null },
      { id: "Snippets", tab: new SnippetManagerSettingTab(this.app, this.plugin) },
      { id: "Link Assist", tab: new LinkAssistSettingTab(this.app, this.plugin) },
      { id: "Scroll Map", tab: new ScrollMapSettingTab(this.app, this.plugin) },
      { id: "Media Manager", tab: new MediaManagerSettingTab(this.app, this.plugin) }
    ];

    for (const { id } of tabs) {
      const button = navEl.createEl("button", {
        text: id,
        cls: `stnd-settings-nav-btn ${this.currentTab === id ? "active" : ""}`,
      });
      button.onclick = () => {
        this.currentTab = id;
        this.display();
      };
    }

    const contentEl = containerEl.createEl("div", {
      cls: "stnd-settings-content",
    });

    const active = tabs.find((t) => t.id === this.currentTab);

    if (active?.tab) {
      active.tab.containerEl = contentEl;
      active.tab.display();
    } else if (this.currentTab === "Garden") {
      this._renderGardenSettings(contentEl);
    } else if (this.currentTab === "General") {
      this._renderGeneralSettings(contentEl);
    } else {
      this._renderStandardSettings(contentEl); // Themes
    }
  }

  _renderGeneralSettings(containerEl) {
    const render = (TabClass) => {
      const el = containerEl.createEl("div");
      const tab = new TabClass(this.app, this.plugin);
      tab.containerEl = el;
      tab.display();
    };
    render(InterfaceManagerSettingTab);
    render(SystemTraySettingTab);
    render(Base64FoldSettingTab);
    render(DailyNavSettingTab);
  }  _renderStandardSettings(containerEl) {
    // ─── Themes Section ───────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Themes" });
    const desc = containerEl.createEl("p", {
      text: "Standard Theme is a modern, responsive design system. It parses frontmatter tokens into live CSS variables on the workspace container to dynamically change color schemes, layout densities, and typographies. ",
      cls: "setting-item-description",
    });
    desc.createEl("a", {
      text: "View Themes & Design System Manual",
      href: "https://stnd.build/guides/obsidian-plugin#3-themes--design-system",
    });

    const themeSetting = new obsidian_1.Setting(containerEl)
      .setName("Standard Theme")
      .setDesc(
        "Enable the core typography, harmonious color palettes, and fluid vertical rhythm of the Standard framework. You can apply pre-bundled themes (e.g., book, technical) or load custom stylesheet overrides from any note named 'name.md' by declaring 'theme: name' in your frontmatter. "
      );
    themeSetting.descEl.createEl("a", {
      text: "Learn about Theme Note Snapping",
      href: "https://stnd.build/guides/obsidian-plugin#3-themes--design-system",
    });
    themeSetting.addToggle((toggle) =>
      toggle
        .setValue(this.plugin.settings.enableTheme)
        .onChange(async (value) => {
          this.plugin.settings.enableTheme = value;
          await this.plugin.saveSettings();
          this.plugin.design.updateBodyClasses();
        }),
    );

    const cacheSetting = new obsidian_1.Setting(containerEl)
      .setName("Clear theme cache")
      .setDesc("Purges the internal cache and forces the plugin to re-scan and hot-reload all theme stylesheets defined in your markdown files. Useful if you edited your custom theme notes but modifications aren't displaying yet. ")
    cacheSetting.descEl.createEl("a", {
      text: "View Cache troubleshooting",
      href: "https://stnd.build/guides/obsidian-plugin#3-themes--design-system",
    });
    cacheSetting.addButton((btn) =>
      btn.setButtonText("Clear Cache").onClick(async () => {
        this.plugin.settings.themeCache = {};
        await this.plugin.saveSettings();
        await this.plugin.design.updateBodyClasses();
        new obsidian_1.Notice("Theme cache cleared");
      }),
    );

    // ─── CSS hooks (reference) ─────────────────────────────────────────────────────
    const hooksSetting = new obsidian_1.Setting(containerEl)
      .setName("CSS Hooks Reference")
      .setDesc(descWithLinks(
        "The plugin continuously reflects active workspace states (like .stnd-note, .stnd-reading, .stnd-published) onto the application body element, enabling you to target editor view states precisely inside your §.",
        [{ text: "custom snippets", href: "https://stnd.build/guides/css-hooks" }]
      ));
    hooksSetting.addButton((btn) =>
      btn.setButtonText("View CSS Hooks").onClick(() => {
        window.open("https://stnd.build/guides/css-hooks", "_blank");
      }),
    );
  }

  _renderPersistentHeader(containerEl) {
    const username = this.plugin.settings.apiUsername;
    const base = (this.plugin.settings.apiUrl || "https://standard.garden/api")
      .replace(/\/api\/?$/, "");
    const gardenUrl = `${base}/@${username}`;

    // ── Identity card ──
    const card = containerEl.createEl("div");
    card.style.cssText =
      "display:flex;align-items:center;gap:12px;padding:14px 16px;" +
      "border:1px solid var(--background-modifier-border);border-radius:12px;margin-top:0px;margin-bottom:12px;";

    const avatar = card.createEl("div", {
      text: username.slice(0, 2).toLowerCase(),
    });
    avatar.style.cssText =
      "width:42px;height:42px;border-radius:50%;display:flex;align-items:center;" +
      "justify-content:center;font-weight:600;flex:0 0 auto;" +
      "background:var(--background-secondary);color:var(--interactive-accent);";

    const idCol = card.createEl("div");
    idCol.style.cssText = "flex:1;min-width:0;";
    const name = idCol.createEl("div", { text: `@${username}` });
    name.style.cssText = "font-weight:600;";
    const link = idCol.createEl("a", {
      text: gardenUrl.replace(/^https?:\/\//, ""),
      href: gardenUrl,
    });
    link.setAttribute("target", "_blank");
    link.style.cssText =
      "font-size:var(--font-ui-smaller);color:var(--text-accent);text-decoration:none;";

    const actions = card.createEl("div");
    actions.style.cssText = "display:flex;gap:6px;flex:0 0 auto;";
    const viewGarden = actions.createEl("button", { text: "Online" });
    viewGarden.classList.add("mod-cta");
    viewGarden.onclick = () => window.open(gardenUrl, "_blank");
    const signout = actions.createEl("button", { text: "Sign out" });
    signout.onclick = async () => {
      this.plugin.settings.apiKey = "";
      this.plugin.settings.apiUsername = "";
      this.plugin.statsCache = null;
      await this.plugin.saveSettings();
      this.plugin.updateRibbonIconsVisibility();
      this.display();
    };

    // Calculate local published count instantly
    const publishKey =
      (this.plugin.settings.keyPrefix || "") + this.plugin.settings.publishKey;
    const localCount = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.[publishKey],
      ).length;

    // ── Account Stats Card ──
    const statsContainer = containerEl.createEl("div", {
      cls: "stnd-account-stats-container",
    });
    statsContainer.style.marginBottom = "0px";
    
    const cachedData = this.plugin.statsCache;

    if (cachedData) {
      // Render immediately from cache to prevent flickering
      this._renderStatsValues(statsContainer, cachedData, localCount);
      
      // Fetch in the background to update cache silently
      fetch(`${this.plugin.settings.apiUrl}/me`, {
        headers: { "x-api-key": this.plugin.settings.apiKey },
      })
        .then((res) => res.ok && res.json())
        .then((data) => {
          if (data) {
            this.plugin.statsCache = data;
            this._updateStatsValues(statsContainer, data, localCount);
          }
        })
        .catch(() => {});
    } else {
      // Show loading indicator only on first load
      const loadingText = statsContainer.createEl("span", {
        cls: "stnd-account-stats-loading",
        text: "Loading stats from garden...",
      });

      fetch(`${this.plugin.settings.apiUrl}/me`, {
        headers: { "x-api-key": this.plugin.settings.apiKey },
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          this.plugin.statsCache = data;
          statsContainer.empty();
          this._renderStatsValues(statsContainer, data, localCount);
        })
        .catch(() => {
          statsContainer.empty();
          statsContainer.createEl("span", {
            cls: "stnd-account-stats-loading",
            text: "Failed to load stats.",
          });
        });
    }
  }

  _renderStatsValues(container, data, localCount) {
    // Local notes count
    const localCol = container.createEl("div", { cls: "stnd-account-stat-col" });
    localCol.createEl("div", {
      cls: "stnd-account-stat-value stnd-stat-local",
      text: String(localCount),
    });
    localCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Local",
    });

    // Published notes count
    const countCol = container.createEl("div", { cls: "stnd-account-stat-col" });
    countCol.createEl("div", {
      cls: "stnd-account-stat-value stnd-stat-published",
      text: String(data.notesCount ?? 0),
    });
    countCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Published",
    });

    // Total views count
    const viewsCol = container.createEl("div", { cls: "stnd-account-stat-col" });
    viewsCol.createEl("div", {
      cls: "stnd-account-stat-value stnd-stat-views",
      text: String(data.totalViews ?? 0),
    });
    viewsCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Views",
    });

    // Last sync time
    const syncCol = container.createEl("div", { cls: "stnd-account-stat-col wide" });
    let syncText = "Never";
    if (data.lastSync) {
      syncText = new Date(data.lastSync).toLocaleDateString();
    }
    syncCol.createEl("div", {
      cls: "stnd-account-stat-value medium stnd-stat-sync",
      text: syncText,
    });
    syncCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Last Sync",
    });
  }

  _updateStatsValues(container, data, localCount) {
    const localEl = container.querySelector(".stnd-stat-local");
    if (localEl) localEl.setText(String(localCount));

    const pubEl = container.querySelector(".stnd-stat-published");
    if (pubEl) pubEl.setText(String(data.notesCount ?? 0));
    
    const viewsEl = container.querySelector(".stnd-stat-views");
    if (viewsEl) viewsEl.setText(String(data.totalViews ?? 0));
    
    const syncEl = container.querySelector(".stnd-stat-sync");
    if (syncEl) {
      let syncText = "Never";
      if (data.lastSync) {
        syncText = new Date(data.lastSync).toLocaleDateString();
      }
      syncEl.setText(syncText);
    }
  }

  _renderGardenSettings(containerEl) {
    if (!this.plugin.settings.apiUsername) {
      this._renderGardenDisconnected(containerEl);
      return;
    }

    // ─── Sync Section ─────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Sync" });

    const syncAllSetting = new obsidian_1.Setting(containerEl)
      .setName("Sync all published notes")
      .setDesc(descWithLinks(
        "Trigger a full § immediately. This will scan all notes with your publish key and reconcile them with standard.garden.",
        [{ text: "manual synchronization", href: "https://stnd.build/guides/obsidian-plugin#manual-actions" }]
      ));
    syncAllSetting.addButton((btn) =>
      btn
        .setButtonText("Sync Now")
        .setCta()
        .onClick(async () => {
          await this.plugin.garden.syncAllPublished();
        })
    );

    const downloadSetting = new obsidian_1.Setting(containerEl)
      .setName("Download new online notes")
      .setDesc(descWithLinks(
        "Pull newly created online notes into your local vault. Non-destructive: it will § your existing local files.",
        [{ text: "never modify or overwrite", href: "https://stnd.build/guides/obsidian-plugin#manual-actions" }]
      ));
    downloadSetting.addButton((btn) =>
      btn
        .setButtonText("Download")
        .onClick(async () => {
          await this.plugin.garden.downloadNewOnlineNotes();
        })
    );

    const startupSetting = new obsidian_1.Setting(containerEl)
      .setName("Sync on startup")
      .setDesc(descWithLinks(
        "Automatically initiate a quiet § 5 seconds after Obsidian loads to ensure your online garden is instantly up to date.",
        [{ text: "background synchronization", href: "https://stnd.build/guides/obsidian-plugin#automated-background-tasks" }]
      ));
    startupSetting.addToggle((toggle) =>
      toggle
        .setValue(this.plugin.settings.autoSyncStartup)
        .onChange(async (v) => {
          this.plugin.settings.autoSyncStartup = v;
          await this.plugin.saveSettings();
        })
    );

    const intervalSetting = new obsidian_1.Setting(containerEl)
      .setName("Background sync interval")
      .setDesc(descWithLinks(
        "Automatically runs a quiet § in the background on the selected schedule (15m, 30m, 1h, 4h, 12h).",
        [{ text: "sync task", href: "https://stnd.build/guides/obsidian-plugin#automated-background-tasks" }]
      ));
    intervalSetting.addDropdown((dropdown) =>
      dropdown
        .addOption("0", "Disabled")
        .addOption("15", "Every 15 minutes")
        .addOption("30", "Every 30 minutes")
        .addOption("60", "Every hour")
        .addOption("240", "Every 4 hours")
        .addOption("720", "Every 12 hours")
        .setValue(this.plugin.settings.autoSyncInterval || "0")
        .onChange(async (v) => {
          this.plugin.settings.autoSyncInterval = v;
          await this.plugin.saveSettings();
          this.plugin.garden.setupAutoSyncInterval();
        })
    );

    const syncDirSetting = new obsidian_1.Setting(containerEl)
      .setName("Sync direction")
      .setDesc(descWithLinks(
        "§ pushes local edits to the Garden only. Two-way reconciles both sides and may overwrite local content.",
        [{ text: "One-way (recommended)", href: "https://stnd.build/guides/obsidian-plugin#sync-direction-modes" }]
      ));
    syncDirSetting.addDropdown((dropdown) =>
      dropdown
        .addOption("1way", "One-way (Obsidian → Garden)")
        .addOption("2way", "Two-way (Reconciliation)")
        .setValue(this.plugin.settings.syncDirection || "1way")
        .onChange(async (v) => {
          this.plugin.settings.syncDirection = v;
          await this.plugin.saveSettings();
        })
    );

    // ─── Garden Settings Section ───────────────────────────────────────────
    containerEl.createEl("h2", { text: "Garden Settings" });

    const publishKeySetting = new obsidian_1.Setting(containerEl)
      .setName("Publish key")
      .setDesc(descWithLinks(
        "The § key that marks a note for sync (e.g., `publish: true` or `publish: public`).",
        [{ text: "frontmatter YAML", href: "https://stnd.build/guides/obsidian-plugin#configuration" }]
      ));
    publishKeySetting.addText((text) =>
      text
        .setPlaceholder("publish")
        .setValue(this.plugin.settings.publishKey)
        .onChange(async (value) => {
          this.plugin.settings.publishKey = value.trim() || "publish";
          await this.plugin.saveSettings();
        })
    );

    const openSetting = new obsidian_1.Setting(containerEl)
      .setName("Open after publish")
      .setDesc(descWithLinks(
        "Automatically § the note's live URL immediately after a successful sync.",
        [{ text: "launch your browser to", href: "https://stnd.build/guides/obsidian-plugin#configuration" }]
      ));
    openSetting.addToggle((toggle) =>
      toggle
        .setValue(this.plugin.settings.openAfterPublish)
        .onChange(async (value) => {
          this.plugin.settings.openAfterPublish = value;
          await this.plugin.saveSettings();
        }),
    );

    const statusSetting = new obsidian_1.Setting(containerEl)
      .setName("Publish status location")
      .setDesc(descWithLinks(
        "Where the § is displayed in the Obsidian workspace (title bar, status bar, ribbon, or hidden).",
        [{ text: "publication status badge", href: "https://stnd.build/guides/obsidian-plugin#configuration" }]
      ));
    statusSetting.addDropdown((dropdown) =>
      dropdown
        .addOption("titlebar", "Title bar (Note header)")
        .addOption("statusbar", "Status bar")
        .addOption("ribbon", "Ribbon bar")
        .addOption("hidden", "Hidden")
        .setValue(this.plugin.settings.publishStatusLocation || "titlebar")
        .onChange(async (value) => {
          this.plugin.settings.publishStatusLocation = value;
          await this.plugin.saveSettings();
          const { PublishStatusFeature } = require("../features/publish-status/index.js");
          const feature = this.plugin.features.find((f) => f instanceof PublishStatusFeature);
          if (feature) feature.refreshAll();
        }),
    );
  }

  _renderGardenDisconnected(containerEl) {
    containerEl.createEl("h2", { text: "Garden Settings" });

    const card = containerEl.createEl("div");
    card.style.cssText =
      "text-align:center;padding:28px 20px;border:1px solid var(--background-modifier-border);border-radius:12px;margin-top:8px;";

    const badge = card.createEl("div");
    badge.style.cssText =
      "width:46px;height:46px;border-radius:50%;display:flex;align-items:center;" +
      "justify-content:center;margin:0 auto 12px;background:var(--background-secondary);" +
      "color:var(--interactive-accent);";
    obsidian_1.setIcon(badge, "leaf");

    const heading = card.createEl("div", {
      text: "Connect your workshop to the web",
    });
    heading.style.cssText =
      "font-size:var(--font-ui-large);font-weight:600;margin-bottom:6px;";

    const desc = card.createEl("div", {
      text: "Publish your notes to your public garden, sync, and stay in control from Obsidian. All other features work locally without an account.",
      cls: "setting-item-description",
    });
    desc.style.cssText = "max-width:380px;margin:0 auto 16px;line-height:1.5;";

    const btn = card.createEl("button", {
      text: "Connect to Garden",
    });
    btn.classList.add("mod-cta");
    btn.onclick = () => this.plugin.garden.startConnect();
  }
}

module.exports = { StandardSettingTab };
