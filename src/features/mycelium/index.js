"use strict";

const { PluginSettingTab, Setting, Notice, SuggestModal, MarkdownView } = require("obsidian");
const { Decoration, ViewPlugin } = require("@codemirror/view");
const { descWithLinks } = require("../../constants.js");

// ─── Engine: Find Outgoing Unlinked Mentions ─────────────────────────────────

function getFileAliases(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  const aliases = [];
  if (cache?.frontmatter?.aliases) {
    const a = cache.frontmatter.aliases;
    if (Array.isArray(a)) aliases.push(...a);
    else if (typeof a === "string") aliases.push(...a.split(",").map(s => s.trim()));
  }
  if (cache?.frontmatter?.alias) {
    const a = cache.frontmatter.alias;
    if (Array.isArray(a)) aliases.push(...a);
    else if (typeof a === "string") aliases.push(...a.split(",").map(s => s.trim()));
  }
  return aliases.filter(Boolean);
}

function escapeRegex(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

async function findOutgoingUnlinkedMentions(app, activeFile) {
  const content = await app.vault.cachedRead(activeFile);
  const files = app.vault.getMarkdownFiles();
  const suggestions = [];

  for (const file of files) {
    if (file.path === activeFile.path) continue;
    
    // Check if it's already explicitly linked
    const resolved = app.metadataCache.resolvedLinks[activeFile.path] || {};
    if (resolved.hasOwnProperty(file.path)) continue;

    const termsToCheck = [file.basename, ...getFileAliases(app, file)];
    let matchFound = false;
    let matchedTerm = "";

    for (const term of termsToCheck) {
      if (term.length < 3) continue; // Skip very short words to avoid noise
      
      const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
      const matches = content.match(regex);
      if (!matches) continue;

      // Count occurrences inside existing links vs total
      const wikiRegex = new RegExp(`\\[\\[[^\\]]*?\\b${escapeRegex(term)}\\b[^\\]]*?\\]\\]`, 'gi');
      const wikiMatches = content.match(wikiRegex) || [];
      const mdRegex = new RegExp(`\\[[^\\]]*?\\b${escapeRegex(term)}\\b[^\\]]*?\\\]\\([^)]+\\)`, 'gi');
      const mdMatches = content.match(mdRegex) || [];
      
      if (matches.length > (wikiMatches.length + mdMatches.length)) {
        matchFound = true;
        matchedTerm = term; // Take the first term that matches
        break;
      }
    }

    if (matchFound) {
      suggestions.push({ file, term: matchedTerm });
    }
  }

  return suggestions;
}

async function graftLink(app, activeFile, suggestion) {
  const content = await app.vault.read(activeFile);
  const term = suggestion.term;
  
  // We want to replace the LAST occurrence of the term that is not inside a link.
  // We can do this by finding all matches of the word, then iterating backwards.
  const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
  let match;
  const allMatches = [];
  while ((match = regex.exec(content)) !== null) {
    allMatches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }

  // Find link boundaries
  const linkBoundaries = [];
  const linkRegex = /(\[\[.*?\]\])|(\[.*?\]\(.*?\))/g;
  let lMatch;
  while ((lMatch = linkRegex.exec(content)) !== null) {
    linkBoundaries.push({ start: lMatch.index, end: lMatch.index + lMatch[0].length });
  }

  // Iterate backwards to find the last valid match
  let targetMatch = null;
  for (let i = allMatches.length - 1; i >= 0; i--) {
    const m = allMatches[i];
    let isInsideLink = false;
    for (const b of linkBoundaries) {
      if (m.start >= b.start && m.end <= b.end) {
        isInsideLink = true;
        break;
      }
    }
    if (!isInsideLink) {
      targetMatch = m;
      break;
    }
  }

  if (targetMatch) {
    const before = content.substring(0, targetMatch.start);
    const after = content.substring(targetMatch.end);
    // If the term exactly matches the basename, link it directly. Else, use alias `[[Basename|term]]`
    let linkStr = `[[${suggestion.file.basename}]]`;
    if (suggestion.file.basename.toLowerCase() !== term.toLowerCase()) {
      linkStr = `[[${suggestion.file.basename}|${targetMatch.text}]]`;
    } else {
      linkStr = `[[${suggestion.file.basename}|${targetMatch.text}]]`; // Ensure casing is preserved
    }
    
    const newContent = before + linkStr + after;
    await app.vault.modify(activeFile, newContent);
    new Notice(`Greffe réussie: ${term} → ${suggestion.file.basename}`);
  } else {
    new Notice(`Impossible de trouver une occurrence valide pour "${term}".`);
  }
}


// ─── Option A: Ghost Links (CodeMirror Extension) ────────────────────────────

const ghostLinksPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = Decoration.none;
      this.view = view;
    }

    update(update) {
      // We don't recompute heavily here. We just rely on the parent plugin 
      // passing down the current suggestions via a state field or direct access.
      // For simplicity in this architectural demo, we'll build decorations based on a global cache
      // attached to the active view's plugin instance.
      if (update.docChanged || update.viewportChanged) {
        this.buildDecorations(update.view);
      }
    }

    buildDecorations(view) {
      const builder = [];
      // We grab the suggestions cached by the MyceliumFeature for the active file
      const suggestions = window.stndMyceliumCache || [];
      if (suggestions.length === 0) {
        this.decorations = Decoration.none;
        return;
      }

      for (let { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const sug of suggestions) {
          const term = sug.term;
          const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
          let match;
          while ((match = regex.exec(text)) !== null) {
             const start = from + match.index;
             const end = start + match[0].length;
             
             // Very basic check to avoid decorating inside existing links
             // In a full parser we'd check tokens, but regex is fast for visible viewport
             const surroundingContext = view.state.doc.sliceString(Math.max(0, start - 5), Math.min(view.state.doc.length, end + 5));
             if (!surroundingContext.includes("[[") && !surroundingContext.includes("]]")) {
                 builder.push(Decoration.mark({
                   class: "mycelium-ghost-link",
                   attributes: { title: `Alt+Click to graft to ${sug.file.basename}`, "data-target": sug.file.path, "data-term": term }
                 }).range(start, end));
             }
          }
        }
      }
      builder.sort((a, b) => a.from - b.from);
      this.decorations = Decoration.set(builder);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown: (e, view) => {
        if (e.altKey && e.target.classList.contains("mycelium-ghost-link")) {
          e.preventDefault();
          const targetPath = e.target.getAttribute("data-target");
          const term = e.target.getAttribute("data-term");
          if (targetPath && term) {
            // Find the file and trigger graft
            const app = view.app || window.app; // Fallback
            const file = app.vault.getAbstractFileByPath(targetPath);
            const activeFile = app.workspace.getActiveFile();
            if (file && activeFile) {
               graftLink(app, activeFile, { file, term });
            }
          }
          return true;
        }
      }
    }
  }
);

// ─── Option B: Grafting Modal ────────────────────────────────────────────────

class GraftingModal extends SuggestModal {
  constructor(app, activeFile, suggestions) {
    super(app);
    this.activeFile = activeFile;
    this.suggestions = suggestions;
    this.setPlaceholder("Select a concept to graft (link)...");
  }

  getSuggestions(query) {
    return this.suggestions.filter((s) =>
      s.file.basename.toLowerCase().includes(query.toLowerCase()) ||
      s.term.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(suggestion, el) {
    el.createEl("div", { text: suggestion.file.basename, cls: "graft-title" });
    el.createEl("small", { text: `Found mention: "${suggestion.term}"`, cls: "graft-desc" });
  }

  async onChooseSuggestion(suggestion, evt) {
    await graftLink(this.app, this.activeFile, suggestion);
  }
}

// ─── Option C: Compost Footer ────────────────────────────────────────────────

class MyceliumFeature {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
        if (!plugin.settings.mycelium) {
      plugin.settings.mycelium = {
        enableGhostLinks: false,
        enableGraftingCommand: true,
        enableCompostFooter: true,
      };
    };
    }
    this.settings = plugin.settings.mycelium;
  }

  
  async load() {
    window.stndMyceliumCache = [];
    
    // Background worker to cache suggestions for the active file
    const updateCache = async () => {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === "md") {
         window.stndMyceliumCache = await findOutgoingUnlinkedMentions(this.app, activeFile);
         // Force CM6 update
         this.app.workspace.updateOptions();
      } else {
         window.stndMyceliumCache = [];
      }
    };

    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", updateCache));
    this.plugin.registerEvent(this.app.metadataCache.on("changed", () => {
       // Debounce
       if (this.cacheTimeout) clearTimeout(this.cacheTimeout);
       this.cacheTimeout = setTimeout(updateCache, 2000);
    }));

    if (this.settings.enableGhostLinks) {
       this.plugin.registerEditorExtension(ghostLinksPlugin);
    }

    if (this.settings.enableGraftingCommand) {
      this.plugin.addCommand({
        id: "mycelium-graft",
        name: "Tend the Mycelium (Find links)",
        callback: async () => {
          const activeFile = this.app.workspace.getActiveFile();
          if (!activeFile || activeFile.extension !== "md") {
            new Notice("Open a markdown note to tend the mycelium.");
            return;
          }
          new Notice("Scanning for roots...");
          const suggestions = await findOutgoingUnlinkedMentions(this.app, activeFile);
          if (suggestions.length === 0) {
            new Notice("No unlinked mentions found.");
            return;
          }
          new GraftingModal(this.app, activeFile, suggestions).open();
        }
      });
    }

    if (this.settings.enableCompostFooter) {
      this.plugin.registerMarkdownPostProcessor(async (el, ctx) => {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!file) return;

        // Ensure we only append once at the very end of the document.
        // Post processors run on chunks, so we must be careful.
        // A simple way is to check if this is the last section.
        const sectionInfo = ctx.getSectionInfo(el);
        if (sectionInfo) {
          // If not the last line of the document, don't append.
          // Fallback: we append a div with a unique ID for this file, and clear it if it exists.
        }
        
        // Better approach for footer: wait for reading view to finish rendering the page,
        // but PostProcessor is chunk-based.
        // Let's create a container and debounce the search to avoid running it 50 times per page.
        
        let container = el.querySelector(".mycelium-compost-footer");
        if (!container) {
          container = document.createElement("div");
          container.className = "mycelium-compost-footer";
          el.appendChild(container);
          
          // Execute search asynchronously
          setTimeout(async () => {
             const suggestions = await findOutgoingUnlinkedMentions(this.app, file);
             if (suggestions.length > 0) {
               container.empty();
               container.createEl("hr");
               container.createEl("h4", { text: "🌱 Mycélium (Mentions potentielles)", cls: "mycelium-footer-title" });
               const btnContainer = container.createEl("div", { cls: "mycelium-footer-buttons" });
               btnContainer.style.display = "flex";
               btnContainer.style.gap = "8px";
               btnContainer.style.flexWrap = "wrap";
               
               for (const sug of suggestions) {
                 const btn = btnContainer.createEl("button", { text: `+ ${sug.file.basename}` });
                 btn.onclick = async () => {
                   await graftLink(this.app, file, sug);
                   btn.remove();
                 };
               }
             }
          }, 100);
        }
      });
    }
  }
}

// ─── Settings Tab ────────────────────────────────────────────────────────────

class MyceliumSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.settings = plugin.settings.mycelium;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Mycelium (Link Assist)" });

    const desc = containerEl.createEl("p", {
      text: "The Mycelium engine connects your thoughts by finding unlinked mentions of other notes in your current text. When you graft a link, it replaces the LAST occurrence of the word, encouraging the reader to read the whole text before clicking away.",
      cls: "setting-item-description",
    });

    
    new Setting(containerEl)
      .setName("Enable Ghost Links (Option A)")
      .setDesc("Subtly underlines potential links in the editor. Alt+Click to instantly graft them.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.enableGhostLinks)
          .onChange(async (value) => {
            this.settings.enableGhostLinks = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Enable Grafting Command")
      .setDesc("Adds a command 'Tend the Mycelium' to the palette. Opens a modal to intentionally graft links.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.enableGraftingCommand)
          .onChange(async (value) => {
            this.settings.enableGraftingCommand = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Enable Compost Footer")
      .setDesc("Silently appends a list of potential links at the bottom of the Reading View for passive discovery.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.enableCompostFooter)
          .onChange(async (value) => {
            this.settings.enableCompostFooter = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}

module.exports = { MyceliumFeature, MyceliumSettingTab };
