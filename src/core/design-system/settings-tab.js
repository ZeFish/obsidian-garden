"use strict";

const { PluginSettingTab, Setting, Notice, setIcon } = require("obsidian");
const { descWithLinks } = require("../../constants.js");

class DesignSystemSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // ─── Design System Section ───────────────────────────────────────────
    containerEl.createEl("h2", { text: "Design System" });
    const desc = containerEl.createEl("p", {
      text: "The Standard Design System is a modern, responsive framework. It parses frontmatter tokens into live CSS variables on the workspace container to dynamically change color schemes, layout densities, and typographies. ",
      cls: "setting-item-description",
    });
    desc.createEl("a", {
      text: "View Design System Manual",
      href: "https://stnd.build/guides/obsidian-plugin#3-themes--design-system",
    });

    const designSystemSetting = new Setting(containerEl)
      .setName("Standard Design System")
      .setDesc(
        "Enable the core typography, harmonious color palettes, and fluid vertical rhythm of the Standard framework. You can apply pre-bundled themes (e.g., book, technical) or load custom stylesheet overrides from any note named 'name.md' by declaring 'theme: name' in your frontmatter. "
      );
    designSystemSetting.descEl.createEl("a", {
      text: "Learn about Theme Note Snapping",
      href: "https://stnd.build/guides/obsidian-plugin#3-themes--design-system",
    });
    designSystemSetting.addToggle((toggle) =>
      toggle
        .setValue(this.plugin.settings.enableDesignSystem)
        .onChange(async (value) => {
          this.plugin.settings.enableDesignSystem = value;
          await this.plugin.saveSettings();
          this.plugin.design.updateBodyClasses();
        }),
    );

    const cacheSetting = new Setting(containerEl)
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
        new Notice("Theme cache cleared");
      }),
    );

    // ─── CSS hooks (reference) ─────────────────────────────────────────────────────
    const hooksSetting = new Setting(containerEl)
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
}

module.exports = { DesignSystemSettingTab };
