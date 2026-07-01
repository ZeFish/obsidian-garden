# Obsidian Garden

Garden is a powerful design token bridge and CSS adapter for Obsidian, bringing curated typographic rhythm, cohesive color palettes, and advanced syntax highlighting to your vault. It also optionally allows you to publish your notes seamlessly to the web.

## Features

- **Design System Bridge**: Injects a robust, modern CSS framework directly into your Obsidian workspace.
- **Curated Themes**: Switch instantly between carefully designed, highly legible themes directly from your note's frontmatter.
- **Advanced Syntax Highlighting**: Enhances code blocks with a post-processor, injecting PrismJS languages seamlessly.
- **Smart Snippets**: Manage CSS snippets effortlessly without restarting the app.
- **Optional Web Publishing**: Sync and publish your notes to `standard.garden` with a single click.

## 🔒 Privacy & Data Usage

Obsidian is a local-first application, and Garden respects that philosophy. 

- **By Default**: Garden operates entirely locally. No data leaves your machine. The design system, themes, and CSS injection are all processed directly within Obsidian.
- **Publishing (Opt-in)**: If you choose to link a `standard.garden` account, the plugin can publish your notes to the web. 
  - **What is sent**: Only the notes you explicitly mark with `publish: true` in their frontmatter, along with any locally embedded images they contain.
  - **Where it is sent**: Data is transmitted securely to the `standard.garden/api` endpoints.
  - **Control**: You can unpublish a note at any time via the command palette, which removes it from the remote server immediately.

## Installation

### From the Obsidian Community Plugins
*(Pending review)*

### Manual Installation
1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from the [Releases](https://github.com/ZeFish/obsidian-garden/releases) page.
2. Place them inside your vault at `.obsidian/plugins/garden/`.
3. Reload Obsidian and enable the plugin.

## Usage

Use the frontmatter of any note to control its appearance:

```yaml
---
theme: booky
cssclasses: [my-custom-class]
publish: true
---
```

## Development

Garden relies on the `@stnd/styles` and `@stnd/themes` packages. To build the plugin locally:

```bash
pnpm install
pnpm run build
```

## License

MIT
