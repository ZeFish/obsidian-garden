"use strict";

const {
  Plugin,
  TFile,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
  ButtonComponent,
  ToggleComponent
} = require("obsidian");

const { descWithLinks } = require("../../constants.js");

class LinkAssistFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    if (!plugin.settings.linkAssist) {
      plugin.settings.linkAssist = {
        blockedTag: "backlink-exclude",
        hideLinkedMentions: false,
        localFilters: [],
        onlyLastLinkClickable: false,
        hideUnlinkedIfLinked: true
      };
    } else {
      // S'assurer de la présence des nouveaux paramètres
      if (plugin.settings.linkAssist.onlyLastLinkClickable === undefined) {
        plugin.settings.linkAssist.onlyLastLinkClickable = false;
      }
      if (plugin.settings.linkAssist.hideUnlinkedIfLinked === undefined) {
        plugin.settings.linkAssist.hideUnlinkedIfLinked = true;
      }
      if (typeof plugin.settings.linkAssist.localFilters === "string") {
        try {
          plugin.settings.linkAssist.localFilters = JSON.parse(plugin.settings.linkAssist.localFilters);
        } catch (e) {
          plugin.settings.linkAssist.localFilters = [];
        }
      }
    }
    this.settings = plugin.settings.linkAssist;
    this.filterTimeout = null;
  }

  async load() {
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => this.delayedFilter()),
    );
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => this.delayedFilter()),
    );
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.delayedFilter(500),
      ),
    );

    // Écouter les clics sur les volets de liens
    this.plugin.registerDomEvent(document, "click", (evt) => {
      const target = evt.target;
      if (
        target.closest('.workspace-leaf-content[data-type="outgoing-link"]') ||
        target.closest('.workspace-leaf-content[data-type="backlink"]')
      ) {
        this.delayedFilter(100);
      }
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof Element &&
              node.classList.contains("search-result-container")
            ) {
              this.delayedFilter(300);
              setTimeout(() => this.delayedFilter(200), 800);
              return;
            }
          }
        }
      }
    });
    this.plugin.register(() => observer.disconnect());

    const watchPanes = () => {
      const panes = document.querySelectorAll(
        '.workspace-leaf-content[data-type="outgoing-link"], .workspace-leaf-content[data-type="backlink"]'
      );
      panes.forEach(pane => {
        observer.observe(pane, {
          childList: true,
          subtree: true,
        });
      });
    };
    
    // Observer initial
    watchPanes();
    
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => watchPanes())
    );

    this.plugin.registerDomEvent(document, "mouseup", () => {
      setTimeout(() => {
        this.delayedFilter(400);
      }, 100);
    });

    // ─── Post-processeur : Unicité du lien cliquable (Dernier lien) ───────────
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.settings?.onlyLastLinkClickable) return;

      const links = Array.from(el.querySelectorAll("a.internal-link"));
      if (links.length <= 1) return;

      const linksByTarget = {};
      links.forEach((link) => {
        const target = link.getAttribute("data-href");
        if (!target) return;
        if (!linksByTarget[target]) linksByTarget[target] = [];
        linksByTarget[target].push(link);
      });

      for (const [target, linkList] of Object.entries(linksByTarget)) {
        if (linkList.length > 1) {
          // Désactiver la cliquabilité de tous les liens sauf le dernier
          for (let i = 0; i < linkList.length - 1; i++) {
            const link = linkList[i];
            const textNode = document.createTextNode(link.textContent);
            link.replaceWith(textNode);
          }
        }
      }
    });
  }

  delayedFilter(delay = 100) {
    if (this.filterTimeout) clearTimeout(this.filterTimeout);
    this.filterTimeout = setTimeout(() => {
      this.filterMentions();
    }, delay);
  }

  async filterMentions() {
    const blockedTag = this.settings?.blockedTag || "backlink-exclude";
    let tagToBlock = blockedTag.trim();
    if (tagToBlock.startsWith("#")) tagToBlock = tagToBlock.substring(1);

    const localFilterRules = this.settings?.localFilters || [];
    const activeFile = this.app.workspace.getActiveFile();
    let activeFileTags = [];
    if (activeFile) {
      const fileCache = this.app.metadataCache.getFileCache(activeFile);
      if (fileCache?.frontmatter?.tags)
        activeFileTags = this.getTagsFromFileCache(fileCache);
    }
    this.processPane(tagToBlock, localFilterRules, activeFileTags);
  }

  async processPane(tagToBlock, localFilterRules, activeFileTags) {
    const panes = document.querySelectorAll(
      ".workspace-leaf-content[data-type='outgoing-link'], .workspace-leaf-content[data-type='backlink']"
    );
    if (panes.length === 0) return;

    for (const pane of Array.from(panes)) {
      const searchContainers = Array.from(
        pane.querySelectorAll(".search-result-container")
      );
      for (const container of searchContainers) {
        const items = Array.from(
          container.querySelectorAll(".search-result-file-match")
        );
        for (const item of items) {
          await this.processElement(
            item,
            tagToBlock,
            localFilterRules,
            activeFileTags,
          );
        }
      }
    }
  }

  async processElement(element, tagToBlock, localFilterRules, activeFileTags) {
    const matchedTextSpan = element.querySelector(
      ".search-result-file-matched-text",
    );
    if (!matchedTextSpan) return { processed: false, hidden: false };
    const mentionedText = matchedTextSpan.textContent?.trim();
    if (!mentionedText) return { processed: false, hidden: false };

    let resolvedFilePath;
    const initialFilePath = element.getAttribute("data-path");
    if (initialFilePath) {
      const abstractFile =
        this.app.vault.getAbstractFileByPath(initialFilePath);
      if (abstractFile instanceof TFile) resolvedFilePath = initialFilePath;
    }

    if (!element.querySelector(".hide-unresolved-btn")) {
      const btn = document.createElement("button");
      btn.textContent = "🙈";
      btn.className = "hide-unresolved-btn";
      btn.onclick = async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (resolvedFilePath) {
          const file = this.app.vault.getAbstractFileByPath(resolvedFilePath);
          if (file && file instanceof TFile) {
            await this.addTagToFile(file, tagToBlock);
            new Notice(`Hidden: ${tagToBlock} added to "${mentionedText}"`);
          }
        } else {
          try {
            await this.app.vault.create(
              `${mentionedText}.md`,
              `--- \ntags: [${tagToBlock.replace("#", "")}]\n---\n\n# ${mentionedText}\n`,
            );
            new Notice(`Created and hidden: "${mentionedText}"`);
          } catch (e) {
            new Notice("Creation failed");
          }
        }
        element.style.display = "none";
        this.filterMentions();
      };
      element.appendChild(btn);
    }

    let shouldHide = false;
    let mentionedFileTags = [];
    let file = null;
    if (resolvedFilePath) {
      const abstractFile =
        this.app.vault.getAbstractFileByPath(resolvedFilePath);
      if (abstractFile instanceof TFile) file = abstractFile;
    }
    if (file instanceof TFile) {
      const fileCache = this.app.metadataCache.getFileCache(file);
      if (fileCache) mentionedFileTags = this.getTagsFromFileCache(fileCache);
    }
    if (tagToBlock && mentionedFileTags.includes(tagToBlock.toLowerCase()))
      shouldHide = true;

    if (!shouldHide && localFilterRules.length > 0) {
      for (const rule of localFilterRules) {
        if (!rule.sourceTag || !rule.targetTag) continue;
        if (
          activeFileTags.includes(
            rule.sourceTag.toLowerCase().replace(/^#/, ""),
          ) &&
          mentionedFileTags.includes(
            rule.targetTag.toLowerCase().replace(/^#/, ""),
          )
        ) {
          shouldHide = true;
          break;
        }
      }
    }

    element.style.display = shouldHide ? "none" : "";
    return { processed: true, hidden: shouldHide };
  }

  async addTagToFile(file, tag) {
    const cleanTag = tag.replace(/^#/, "");
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let tags = fm.tags;
      if (!tags) {
        fm.tags = [cleanTag];
      } else if (Array.isArray(tags)) {
        if (!tags.includes(cleanTag)) {
          tags.push(cleanTag);
        }
      } else if (typeof tags === "string") {
        const splitTags = tags.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
        if (!splitTags.includes(cleanTag)) {
          splitTags.push(cleanTag);
          fm.tags = splitTags;
        }
      }
    });
  }

  async removeTagFromFile(file, tag) {
    const cleanTag = tag.replace(/^#/, "");
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let tags = fm.tags;
      if (Array.isArray(tags)) {
        fm.tags = tags.filter(t => t !== cleanTag);
        if (fm.tags.length === 0) delete fm.tags;
      } else if (typeof tags === "string") {
        const splitTags = tags.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
        const filtered = splitTags.filter(t => t !== cleanTag);
        if (filtered.length === 0) {
          delete fm.tags;
        } else {
          fm.tags = filtered.join(", ");
        }
      }
    });
  }

  getIncomingLinks(activeFile) {
    const incoming = [];
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (targets.hasOwnProperty(activeFile.path)) {
        if (sourcePath === activeFile.path) continue;
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (file && file instanceof TFile) {
          incoming.push(file);
        }
      }
    }
    return incoming;
  }

  async getUnlinkedMentions(activeFile) {
    const unlinked = [];
    const query = activeFile.basename.toLowerCase();
    if (!query) return [];

    const files = this.app.vault.getMarkdownFiles();
    const resolvedLinks = this.app.metadataCache.resolvedLinks;

    for (const file of files) {
      if (file.path === activeFile.path) continue;

      // 1. Vérifier si le fichier lie déjà explicitement activeFile
      const targets = resolvedLinks[file.path] || {};
      const alreadyLinks = targets.hasOwnProperty(activeFile.path);

      if (alreadyLinks && this.settings.hideUnlinkedIfLinked) {
        continue;
      }

      // 2. Scanner le contenu du fichier
      const content = await this.app.vault.cachedRead(file);
      if (this.hasUnlinkedMention(content, query)) {
        unlinked.push(file);
      }
    }

    return unlinked;
  }

  hasUnlinkedMention(content, query) {
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const wordRegex = new RegExp(`\\b${escapedQuery}\\b`, 'gi');
    const matches = content.match(wordRegex);
    if (!matches) return false;
    const totalCount = matches.length;

    // Nombre d'occurrences sous forme de Wiki-liens
    const wikiRegex = new RegExp(`\\[\\[([^\\]]*?\\b${escapedQuery}\\b[^\\]]*?)\\]\\]`, 'gi');
    const wikiMatches = content.match(wikiRegex) || [];

    // Nombre d'occurrences sous forme de liens Markdown
    const mdRegex = new RegExp(`\\[[^\\]]*?\\b${escapedQuery}\\b[^\\]]*?\\]\\([^)]+\\)|\\[[^\\]]+\\]\\([^)]*?\\b${escapedQuery}\\b[^)]*?\\)`, 'gi');
    const mdMatches = content.match(mdRegex) || [];

    const linkedCount = wikiMatches.length + mdMatches.length;
    return totalCount > linkedCount;
  }

  replaceFirstUnlinkedOccurrence(content, query) {
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const pattern = new RegExp(`(\\[\\[[^\\]]+\\]\\]|\\[[^\\]]+\\]\\([^)]+\\))|\\b(${escapedQuery})\\b`, 'gi');
    
    let replaced = false;
    const newContent = content.replace(pattern, (match, link, word) => {
      if (link) {
        return match;
      }
      if (word && !replaced) {
        replaced = true;
        return `[[${word}]]`;
      }
      return match;
    });
    
    return newContent;
  }

  getTagsFromFileCache(fileCache) {
    const tags = [];
    if (fileCache.frontmatter?.tags) {
      const rawTags = fileCache.frontmatter.tags;
      if (Array.isArray(rawTags))
        tags.push(...rawTags.map((t) => t.toLowerCase().replace(/^#/, "")));
      else
        typeof rawTags === "string" &&
          tags.push(
            ...rawTags
              .split(/[,\s]+/)
              .map((t) => t.toLowerCase().replace(/^#/, "")),
          );
    }
    if (fileCache.tags)
      tags.push(
        ...fileCache.tags.map((t) => t.tag.toLowerCase().replace(/^#/, "")),
      );
    return Array.from(new Set(tags));
  }
}

class LinkAssistSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    if (!this.plugin.settings.linkAssist) {
      this.plugin.settings.linkAssist = {
        blockedTag: "backlink-exclude",
        hideLinkedMentions: false,
        localFilters: [],
        onlyLastLinkClickable: false,
        hideUnlinkedIfLinked: true
      };
    }
    this.settings = this.plugin.settings.linkAssist;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Link Assist" });

    const desc = containerEl.createEl("p", {
      text: "Optimizes note navigation, backlinks, and reading experiences. ",
      cls: "setting-item-description",
    });
    desc.createEl("a", {
      text: "View Link Assist Manual",
      href: "https://stnd.build/3-archives/obsidian-plugin#5-link-assist",
    });

    new Setting(containerEl)
      .setName("Exclusion tag")
      .setDesc(descWithLinks("Tag used to hide notes from linked mentions (without the #). § for the full list of what gets filtered.", [{ text: "See the Link Assist guide", href: "https://stnd.build/3-archives/obsidian-plugin#5-link-assist" }]))
      .addText((text) =>
        text
          .setPlaceholder("backlink-exclude")
          .setValue(this.settings.blockedTag || "backlink-exclude")
          .onChange(async (value) => {
            this.settings.blockedTag = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hide already linked mentions")
      .setDesc(descWithLinks("Hide unlinked mentions of a note if it already contains an explicit link to it — §.", [{ text: "learn how mention filtering works", href: "https://stnd.build/3-archives/obsidian-plugin#5-link-assist" }]))
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.hideUnlinkedIfLinked || false)
          .onChange(async (value) => {
            this.settings.hideUnlinkedIfLinked = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Unique clickable link")
      .setDesc(descWithLinks("Only make the last occurrence of the same link in a note clickable (previous ones appear as plain text). § for readability rationale.", [{ text: "Read the docs", href: "https://stnd.build/3-archives/obsidian-plugin#5-link-assist" }]))
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.onlyLastLinkClickable || false)
          .onChange(async (value) => {
            this.settings.onlyLastLinkClickable = value;
            await this.plugin.saveSettings();
          }),
      );

    // Section Local Filters
    containerEl.createEl("h3", { text: "Local cross filters" });
    containerEl.createEl("p", {
      text: "Hide mentions if the active note has a source tag and the linked note has a target tag.",
      cls: "setting-item-description"
    });

    let filters = this.settings.localFilters;
    if (typeof filters === "string") {
      try {
        filters = JSON.parse(filters);
      } catch (e) {
        filters = [];
      }
    }
    if (!Array.isArray(filters)) {
      filters = [];
    }
    this.settings.localFilters = filters;

    const filtersListContainer = containerEl.createEl("div");
    filtersListContainer.style.marginBottom = "15px";

    const renderFilterRow = (rule, idx) => {
      const rowEl = filtersListContainer.createEl("div");
      rowEl.style.display = "flex";
      rowEl.style.gap = "8px";
      rowEl.style.alignItems = "center";
      rowEl.style.marginBottom = "8px";

      const sourceComp = new TextComponent(rowEl);
      sourceComp.setPlaceholder("Source Tag (e.g., personal)");
      sourceComp.setValue(rule.sourceTag || "");
      sourceComp.inputEl.style.flex = "1";
      sourceComp.onChange(async (val) => {
        rule.sourceTag = val.trim();
        await this.plugin.saveSettings();
      });

      const targetComp = new TextComponent(rowEl);
      targetComp.setPlaceholder("Target Tag (e.g., work)");
      targetComp.setValue(rule.targetTag || "");
      targetComp.inputEl.style.flex = "1";
      targetComp.onChange(async (val) => {
        rule.targetTag = val.trim();
        await this.plugin.saveSettings();
      });

      new ButtonComponent(rowEl)
        .setIcon("trash")
        .setWarning()
        .setTooltip("Delete this rule")
        .onClick(async () => {
          filters.splice(idx, 1);
          await this.plugin.saveSettings();
          this.display();
        });
    };

    filters.forEach((rule, idx) => {
      renderFilterRow(rule, idx);
    });

    new Setting(containerEl)
      .setName("Add filter rule")
      .setDesc(descWithLinks("Hide mentions based on crossed tags. § to understand the rule logic.", [{ text: "View cross-filter guide", href: "https://stnd.build/3-archives/obsidian-plugin#5-link-assist" }]))
      .addButton((btn) =>
        btn
          .setButtonText("+ Add a rule")
          .onClick(async () => {
            filters.push({ sourceTag: "", targetTag: "" });
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }
}

module.exports = { LinkAssistFeature, LinkAssistSettingTab };
