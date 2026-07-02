"use strict";

const obsidian_1 = require("obsidian");

// Core setting tabs
const { GardenSettingTab } = require("../core/garden/settings-tab.js");
const { DesignSystemSettingTab } = require("../core/design-system/settings-tab.js");
const { GeneralSettingTab } = require("./general-tab.js");

// Feature setting tabs
// (Echo, Hollow, Feed moved to the Atelier plugin — see apps/obsidian-atelier.)
const { HotFolderSettingTab } = require("../features/hot-folder/index.js");
const { LinkAssistSettingTab } = require("../features/link-assist/index.js");
const { ScrollMapSettingTab } = require("../features/scroll-map/index.js");
const { SnippetManagerSettingTab } = require("../features/snippet-manager/index.js");
const { MediaManagerSettingTab } = require("../features/vault-audit/index.js");

class StandardSettingTab extends obsidian_1.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.currentTab = "Garden";
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.style.paddingTop = "32px";

    const headerTitle = containerEl.createEl("h2", { text: "Standard::Garden" });
    headerTitle.style.cssText = "margin: 0 0 16px 0; font-size: var(--font-ui-large); font-weight: 600; text-align: left;";

    const hasHeader = !!this.plugin.settings.apiUsername;
    if (hasHeader) {
      this._renderPersistentHeader(containerEl);

      const divider = containerEl.createEl("hr", { cls: "stnd-settings-divider" });
      divider.style.cssText = "margin: 24px 0; border: 0; border-top: 1px solid var(--background-modifier-border);";
    }

    const navEl = containerEl.createEl("div", { cls: "stnd-settings-nav" });
    navEl.style.cssText = `display: flex; justify-content: flex-start; gap: 6px; flex-wrap: wrap; margin: ${hasHeader ? "0" : "12px"} 0 12px;`;

    const tabs = [
      { id: "Garden", tab: new GardenSettingTab(this.app, this.plugin) },
      { id: "Hot Folder", tab: new HotFolderSettingTab(this.app, this.plugin) },
      { id: "General", tab: new GeneralSettingTab(this.app, this.plugin) },
      { id: "Design System", tab: new DesignSystemSettingTab(this.app, this.plugin) },
      { id: "Snippets", tab: new SnippetManagerSettingTab(this.app, this.plugin) },
      { id: "Link Assist", tab: new LinkAssistSettingTab(this.app, this.plugin) },
      { id: "Scroll Map", tab: new ScrollMapSettingTab(this.app, this.plugin) },
      { id: "Media Manager", tab: new MediaManagerSettingTab(this.app, this.plugin) },
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
    }
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
      this._renderStatsValues(statsContainer, cachedData, localCount);

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
      statsContainer.createEl("span", {
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
    const localCol = container.createEl("div", { cls: "stnd-account-stat-col" });
    localCol.createEl("div", {
      cls: "stnd-account-stat-value stnd-stat-local",
      text: String(localCount),
    });
    localCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Local",
    });

    const countCol = container.createEl("div", { cls: "stnd-account-stat-col" });
    countCol.createEl("div", {
      cls: "stnd-account-stat-value stnd-stat-published",
      text: String(data.notesCount ?? 0),
    });
    countCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Published",
    });

    const viewsCol = container.createEl("div", { cls: "stnd-account-stat-col" });
    viewsCol.createEl("div", {
      cls: "stnd-account-stat-value stnd-stat-views",
      text: String(data.totalViews ?? 0),
    });
    viewsCol.createEl("div", {
      cls: "stnd-account-stat-label",
      text: "Views",
    });

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
}

module.exports = { StandardSettingTab };
