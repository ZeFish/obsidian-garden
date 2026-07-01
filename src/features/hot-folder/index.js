"use strict";

const {
  Plugin,
  TFile,
  Modal,
  Setting,
  Notice,
  PluginSettingTab,
  TextComponent,
  ButtonComponent,
  DropdownComponent,
  ToggleComponent,
} = require("obsidian");
const { descWithLinks } = require("../../constants.js");

function toArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.filter(
      (item) =>
        item !== null && item !== undefined && String(item).trim() !== "",
    );
  }
  const stringVal = String(val).trim();
  return stringVal !== "" ? [stringVal] : [];
}

class HotFolderFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    if (!plugin.settings.hotFolder) plugin.settings.hotFolder = { rules: [] };
    this.settings = plugin.settings.hotFolder;
  }

  async load() {
    this.plugin.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md")
          await this.applyRules(file);
      }),
    );
    this.plugin.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (file instanceof TFile && file.extension === "md")
          await this.applyRules(file);
      }),
    );

    this.plugin.addCommand({
      id: "auto-fm-apply-current",
      name: "Apply rules to current file",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          await this.applyRules(file);
          new Notice("Auto Frontmatter: rules applied.");
        } else {
          new Notice("No markdown file active.");
        }
      },
    });
  }

  async applyRules(file) {
    const path = file.path.replace(/\\/g, "/");
    const rules = this.settings?.rules || [];
    const matchingRules = rules.filter((r) =>
      this.isFileInFolder(path, r.folder),
    );

    if (matchingRules.length === 0) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const newValues = {};
      for (const rule of matchingRules) {
        for (const k in rule.frontmatter) {
          const incoming = rule.frontmatter[k];
          if (Array.isArray(incoming)) {
            const existing = toArray(frontmatter[k]);
            for (const val of incoming)
              if (!existing.includes(val)) existing.push(val);
            newValues[k] = existing;
          } else {
            if (k === "tags" || k === "tag" || k === "keywords") {
              const existing = toArray(frontmatter[k]);
              if (!existing.includes(incoming)) existing.push(incoming);
              newValues[k] = existing;
            } else {
              newValues[k] = incoming;
            }
          }
        }
      }

      for (const [key, newValue] of Object.entries(newValues)) {
        frontmatter[key] = newValue;
      }
    });
  }

  isFileInFolder(filePath, folder) {
    if (!folder) return false;
    const normFolder = folder.replace(/^\/+|\/+$/g, "").toLowerCase();
    if (normFolder === "") return false;
    const lastSlash = filePath.lastIndexOf("/");
    const dirPath = lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
    const searchIn = "/" + dirPath.toLowerCase() + "/";
    const searchFor = "/" + normFolder + "/";
    return searchIn.includes(searchFor);
  }
}

class HotFolderSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    if (!this.plugin.settings.hotFolder) {
      this.plugin.settings.hotFolder = { rules: [] };
    }
    this.settings = this.plugin.settings.hotFolder;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Hot Folder" });

    const desc = containerEl.createEl("p", {
      text: "Hot Folder rules automate metadata hygiene in your vault. When a markdown note is created inside or moved to a target folder, the plugin automatically writes the configured frontmatter properties to its YAML header without overwriting existing keys. ",
      cls: "setting-item-description",
    });
    desc.createEl("a", {
      text: "View Hot Folder Manual",
      href: "https://stnd.build/guides/obsidian-plugin#2-hot-folder",
    });

    const listContainer = containerEl.createEl("div", {
      cls: "hot-folder-rules-list",
    });
    this.renderRulesList(listContainer);

    new Setting(containerEl)
      .setName("Add new rule")
      .setDesc(descWithLinks(
        "Create a new rule mapping a folder to a set of default frontmatter properties. § for rule examples.",
        [{ text: "View Hot Folder guide", href: "https://stnd.build/guides/obsidian-plugin#2-hot-folder" }]
      ))
      .addButton((btn) =>
        btn
          .setButtonText("+ Add a rule")
          .setCta()
          .onClick(async () => {
            if (!this.settings.rules) this.settings.rules = [];
            this.settings.rules.push({ folder: "", frontmatter: {} });
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }

  renderRulesList(container) {
    container.empty();
    const rules = this.settings?.rules || [];

    if (rules.length === 0) {
      container.createEl("p", {
        text: "No rules configured. Click the button above to add your first folder automation rule.",
        cls: "setting-item-description",
      });
      return;
    }

    rules.forEach((rule, i) => {
      const ruleContainer = container.createEl("div", {
        cls: "hot-folder-rule-container",
      });
      ruleContainer.style.border =
        "1px solid var(--background-modifier-border)";
      ruleContainer.style.padding = "16px";
      ruleContainer.style.marginBottom = "16px";
      ruleContainer.style.borderRadius = "8px";
      ruleContainer.style.backgroundColor = "var(--background-secondary)";

      const pathSetting = new Setting(ruleContainer)
        .setName(`Rule ${i + 1}: Target Folder`)
        .setDesc(descWithLinks(
          "The folder path in your vault. The rule applies to any note created or moved inside this folder structure. § for path syntax.",
          [{ text: "Learn about folder patterns", href: "https://stnd.build/guides/obsidian-plugin#2-hot-folder" }]
        ));
      pathSetting.addText((text) => {
          text
            .setPlaceholder("e.g., Projects/Active")
            .setValue(rule.folder)
            .onChange(async (value) => {
              this.settings.rules[i].folder = value.trim();
              await this.plugin.saveSettings();
            });

          const { FolderSuggest } = require("../../ui/folder-suggest.js");
          new FolderSuggest(this.app, text.inputEl);
        })
        .addButton((btn) =>
          btn
            .setIcon("trash")
            .setWarning()
            .setTooltip("Delete this rule")
            .onClick(async () => {
              this.settings.rules.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            }),
        );

      // Section propriétés Frontmatter
      const propHeader = ruleContainer.createEl("div");
      propHeader.style.display = "flex";
      propHeader.style.justifyContent = "space-between";
      propHeader.style.alignItems = "center";
      propHeader.style.marginTop = "15px";
      propHeader.style.marginBottom = "10px";

      propHeader.createEl("strong", { text: "Frontmatter Properties" });

      // Convertir le frontmatter actuel en tableau d'entrées
      const entries = Object.entries(rule.frontmatter || {}).map(([key, value]) => {
        let type = "text";
        if (Array.isArray(value)) type = "list";
        else if (typeof value === "boolean") type = "boolean";
        else if (typeof value === "number") type = "number";

        return { key, value, type };
      });

      const rebuild = async () => {
        rule.frontmatter = {};
        entries.forEach((e) => {
          if (!e.key.trim()) return;

          if (e.type === "list") {
            if (Array.isArray(e.value)) {
              rule.frontmatter[e.key] = e.value;
            } else {
              rule.frontmatter[e.key] = String(e.value)
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            }
          } else if (e.type === "number") {
            const num = Number(e.value);
            rule.frontmatter[e.key] = isNaN(num) ? 0 : num;
          } else if (e.type === "boolean") {
            rule.frontmatter[e.key] = !!e.value;
          } else {
            rule.frontmatter[e.key] = String(e.value);
          }
        });
        await this.plugin.saveSettings();
      };

      const propsListContainer = ruleContainer.createEl("div");

      const renderPropertyRow = (entry) => {
        const rowEl = propsListContainer.createEl("div");
        rowEl.style.display = "flex";
        rowEl.style.gap = "8px";
        rowEl.style.alignItems = "center";
        rowEl.style.marginBottom = "8px";

        // 1. Clé
        const keyComp = new TextComponent(rowEl);
        keyComp.setPlaceholder("Key (e.g., tags)");
        keyComp.setValue(entry.key);
        keyComp.inputEl.style.flex = "1";
        keyComp.inputEl.style.minWidth = "80px";
        keyComp.onChange(async (val) => {
          entry.key = val.trim();
          await rebuild();
        });

        // 2. Type
        const typeComp = new DropdownComponent(rowEl);
        typeComp.addOption("text", "Text");
        typeComp.addOption("list", "List");
        typeComp.addOption("number", "Number");
        typeComp.addOption("boolean", "Boolean");
        typeComp.setValue(entry.type);
        typeComp.selectEl.style.width = "90px";
        typeComp.onChange(async (val) => {
          entry.type = val;
          // Conversion de la valeur
          if (entry.type === "list") {
            entry.value = typeof entry.value === "string" ? [entry.value] : [];
          } else if (entry.type === "boolean") {
            entry.value = true;
          } else if (entry.type === "number") {
            entry.value = 0;
          } else {
            entry.value = String(entry.value);
          }
          await rebuild();
          this.display();
        });

        // 3. Valeur (dépend du type)
        if (entry.type === "boolean") {
          const toggleComp = new ToggleComponent(rowEl);
          toggleComp.setValue(!!entry.value);
          toggleComp.onChange(async (val) => {
            entry.value = val;
            await rebuild();
          });
          const spacer = rowEl.createEl("div");
          spacer.style.flex = "1.5";
        } else if (entry.type === "number") {
          const valComp = new TextComponent(rowEl);
          valComp.inputEl.type = "number";
          valComp.setPlaceholder("0");
          valComp.setValue(String(entry.value));
          valComp.inputEl.style.flex = "1.5";
          valComp.inputEl.style.minWidth = "80px";
          valComp.onChange(async (val) => {
            entry.value = Number(val);
            await rebuild();
          });
        } else if (entry.type === "list") {
          const valComp = new TextComponent(rowEl);
          valComp.setPlaceholder("value1, value2");
          valComp.setValue(Array.isArray(entry.value) ? entry.value.join(", ") : String(entry.value));
          valComp.inputEl.style.flex = "1.5";
          valComp.inputEl.style.minWidth = "80px";
          valComp.onChange(async (val) => {
            entry.value = val
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await rebuild();
          });
        } else {
          const valComp = new TextComponent(rowEl);
          valComp.setPlaceholder("Value");
          valComp.setValue(String(entry.value));
          valComp.inputEl.style.flex = "1.5";
          valComp.inputEl.style.minWidth = "80px";
          valComp.onChange(async (val) => {
            entry.value = val;
            await rebuild();
          });
        }

        // 4. Bouton supprimer propriété
        new ButtonComponent(rowEl)
          .setIcon("trash")
          .setWarning()
          .setTooltip("Delete this property")
          .onClick(async () => {
            const idx = entries.indexOf(entry);
            if (idx > -1) {
              entries.splice(idx, 1);
              rowEl.remove();
              await rebuild();
            }
          });
      };

      entries.forEach((entry) => {
        renderPropertyRow(entry);
      });

      // Bouton pour ajouter une propriété
      new ButtonComponent(propHeader)
        .setButtonText("+ Add a property")
        .onClick(async () => {
          const newEntry = { key: "", value: "", type: "text" };
          entries.push(newEntry);
          renderPropertyRow(newEntry);
        });
    });
  }
}

module.exports = { HotFolderFeature, HotFolderSettingTab };
