"use strict";

const { PluginSettingTab, Setting, Notice } = require("obsidian");
const { descWithLinks } = require("../../constants.js");

class GardenSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    if (!this.plugin.settings.apiUsername) {
      this._renderDisconnected(containerEl);
      return;
    }

    // ─── Sync Section ─────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Sync" });

    const syncAllSetting = new Setting(containerEl)
      .setName("Sync all published notes")
      .setDesc(descWithLinks(
        "Trigger a full § immediately. This will scan all notes with your publish key and reconcile them with standard.garden.",
        [{ text: "manual synchronization", href: "https://stnd.build/3-archives/obsidian-plugin#manual-actions" }]
      ));
    syncAllSetting.addButton((btn) =>
      btn
        .setButtonText("Sync Now")
        .setCta()
        .onClick(async () => {
          await this.plugin.garden.syncAllPublished();
        })
    );

    const downloadSetting = new Setting(containerEl)
      .setName("Download new online notes")
      .setDesc(descWithLinks(
        "Pull newly created online notes into your local vault. Non-destructive: it will § your existing local files.",
        [{ text: "never modify or overwrite", href: "https://stnd.build/3-archives/obsidian-plugin#manual-actions" }]
      ));
    downloadSetting.addButton((btn) =>
      btn
        .setButtonText("Download")
        .onClick(async () => {
          await this.plugin.garden.downloadNewOnlineNotes();
        })
    );

    const startupSetting = new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc(descWithLinks(
        "Automatically initiate a quiet § 5 seconds after Obsidian loads to ensure your online garden is instantly up to date.",
        [{ text: "background synchronization", href: "https://stnd.build/3-archives/obsidian-plugin#automated-background-tasks" }]
      ));
    startupSetting.addToggle((toggle) =>
      toggle
        .setValue(this.plugin.settings.autoSyncStartup)
        .onChange(async (v) => {
          this.plugin.settings.autoSyncStartup = v;
          await this.plugin.saveSettings();
        })
    );

    const intervalSetting = new Setting(containerEl)
      .setName("Background sync interval")
      .setDesc(descWithLinks(
        "Automatically runs a quiet § in the background on the selected schedule (15m, 30m, 1h, 4h, 12h).",
        [{ text: "sync task", href: "https://stnd.build/3-archives/obsidian-plugin#automated-background-tasks" }]
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

    const syncDirSetting = new Setting(containerEl)
      .setName("Sync direction")
      .setDesc(descWithLinks(
        "§ pushes local edits to the Garden only. Two-way reconciles both sides and may overwrite local content.",
        [{ text: "One-way (recommended)", href: "https://stnd.build/3-archives/obsidian-plugin#sync-direction-modes" }]
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

    const publishKeySetting = new Setting(containerEl)
      .setName("Publish key")
      .setDesc(descWithLinks(
        "The § key that marks a note for sync (e.g., `publish: true` or `publish: public`).",
        [{ text: "frontmatter YAML", href: "https://stnd.build/3-archives/obsidian-plugin#configuration" }]
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

    const openSetting = new Setting(containerEl)
      .setName("Open after publish")
      .setDesc(descWithLinks(
        "Automatically § the note's live URL immediately after a successful sync.",
        [{ text: "launch your browser to", href: "https://stnd.build/3-archives/obsidian-plugin#configuration" }]
      ));
    openSetting.addToggle((toggle) =>
      toggle
        .setValue(this.plugin.settings.openAfterPublish)
        .onChange(async (value) => {
          this.plugin.settings.openAfterPublish = value;
          await this.plugin.saveSettings();
        }),
    );

    const statusSetting = new Setting(containerEl)
      .setName("Publish status location")
      .setDesc(descWithLinks(
        "Where the § is displayed in the Obsidian workspace (title bar, status bar, ribbon, or hidden).",
        [{ text: "publication status badge", href: "https://stnd.build/3-archives/obsidian-plugin#configuration" }]
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
          const { PublishStatusFeature } = require("../../features/publish-status/index.js");
          const feature = this.plugin.features.find((f) => f instanceof PublishStatusFeature);
          if (feature) feature.refreshAll();
        }),
    );
  }

  _renderDisconnected(containerEl) {
    containerEl.createEl("h2", { text: "Garden Settings" });

    const card = containerEl.createEl("div");
    card.style.cssText =
      "text-align:center;padding:28px 20px;border:1px solid var(--background-modifier-border);border-radius:12px;margin-top:8px;";

    const badge = card.createEl("div");
    badge.style.cssText =
      "width:46px;height:46px;border-radius:50%;display:flex;align-items:center;" +
      "justify-content:center;margin:0 auto 12px;background:var(--background-secondary);" +
      "color:var(--interactive-accent);";
    const { setIcon } = require("obsidian");
    setIcon(badge, "leaf");

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

module.exports = { GardenSettingTab };
