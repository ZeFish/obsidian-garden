"use strict";

const { PluginSettingTab } = require("obsidian");
const { InterfaceManagerSettingTab } = require("../features/interface-manager/index.js");
const { Base64FoldSettingTab } = require("../features/base64-fold/index.js");
const { DailyNavSettingTab } = require("../features/daily-nav/index.js");

class GeneralSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    for (const TabClass of [InterfaceManagerSettingTab, Base64FoldSettingTab, DailyNavSettingTab]) {
      const el = containerEl.createEl("div");
      const tab = new TabClass(this.app, this.plugin);
      tab.containerEl = el;
      tab.display();
    }
  }
}

module.exports = { GeneralSettingTab };
