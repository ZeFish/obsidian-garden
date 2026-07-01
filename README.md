---
title: garden-obsidian
aliases: []
created: 2026-06-20 13:27
modified: 2026-06-23 20:29
maturity: sprout
mode: read
publish: false
status: active
tags:
  - projet
  - stnd
  - garden
  - obsidian
theme: terminal
type: project
visibility: private
---

# Standard Garden — Obsidian Plugin

> **Where it’s at — now:** active — the Garden bridge (design tokens + curated themes +
> publish flow). The open work (plugin UX, settings nav grouping into Atelier/Garden, the
> `graft:` key check) is tracked in the **Garden README → *What’s next → Plugin UX***, not
> duplicated here. To rename → `garden-obsidian`.

![ScreenShot](src/screenshot.gif)

A design-token bridge for Obsidian. Control your styling with frontmatter — pick a curated **theme**, fine-tune **design tokens**, and publish your vault to [Standard Garden](https://standard.garden) with the same look you intended.

---

## How it works

The plugin turns frontmatter into live, publish-safe styling:

- **Design tokens** in frontmatter inject CSS variables directly into the document (e.g. `font-header: "Inter"` → `--font-header: "Inter"`)
- A **`theme:`** key applies a curated theme bundled with the plugin
- The current view state is reflected as body classes for CSS targeting

What you see in the editor is what publishes to Standard Garden — no note-local CSS that only works on your machine.

> **Looking for vault-wide CSS snippets?** That power-user feature now lives in the **Atelier** plugin (the personal workshop). Standard Garden stays focused on what publishes: themes, tokens, and the publishing flow.

---

## Themes

Set a theme on any note with the `theme:` frontmatter key. The theme’s colors, fonts, and type metrics apply instantly — and publish identically.

```yaml
---
theme: editorial
---
```

Available themes (curated, bundled with the plugin): `editorial`, `humanist`, `technical`, `academic`, `mono`, `swiss`, `gallery`, and many more. Themes are generated from a single source of truth in `@stnd/themes`, so the look in Obsidian matches standard.garden.

Per-note design tokens (below) always override the theme, so you can start from a theme and tweak.

### Cascade order

Styling is layered so the most specific wins:

```yml
[data-theme="…"]    ← curated theme tokens (theme: frontmatter)
#stnd-frontmatter   ← per-note design tokens (font-*, color-*, … keys)
```

---

## Frontmatter reference

> **Clean syntax**: Frontmatter keys map directly to CSS custom properties. The key name *is* the variable name minus `--`. No prefix needed. Legacy `stdn-*` prefixed keys still work for backward compatibility.

### Typography

```yaml
font-text: "Inter"                              # Body text font
font-header: "Merriweather"                     # Headings (H1–H6)
font-monospace: "Fira Code"                     # Code blocks
font-interface: "System-UI"                     # Obsidian UI

optical-ratio: 1.25                             # Modular scale ratio between type sizes
font-density: 1.2                               # Line height multiplier

font-weight: 400
font-weight-bold: 700
font-feature: "'liga', 'kern'"                  # OpenType features
font-variation: "'wght' 400"                    # Variable font axis

font-header-weight: 600
font-header-style: normal
font-header-letter-spacing: "-0.02em"
font-header-feature: "'liga'"
font-header-variation: "'wght' 600"

font-monospace-feature: "'liga'"
font-monospace-variation: "'wght' 400"

font-interface-feature: "'liga'"
font-interface-variation: "'wght' 400"
```

Font values for `font-text`, `font-header`, `font-monospace`, and `font-interface` automatically generate a Google Fonts `@import`. No manual setup needed.

### Colors

```yaml
# Light theme
color-light-foreground: "#1a1a1a"
color-light-background: "#ffffff"
color-light-red: "#dc3545"
color-light-orange: "#fd7e14"
color-light-yellow: "#ffc107"
color-light-green: "#28a745"
color-light-cyan: "#17a2b8"
color-light-blue: "#007bff"
color-light-purple: "#6f42c1"
color-light-pink: "#e83e8c"
color-light-accent: "#007bff"
color-light-bold: "#000000"
color-light-italic: "#495057"

# Dark theme — same keys with -dark-
color-dark-foreground: "#ffffff"
color-dark-background: "#1a1a1a"
# ...

# Semantic (mode-agnostic)
color-header: "#1a1a1a"
color-bold: "#000000"
color-italic: "#495057"
color-accent: "#007bff"
```

### Vertical rhythm

```yaml
margin: "1rlh"           # Base spacing unit
margin-block: 2          # Block separation multiplier
```

### Custom CSS variables (legacy)

Any `stdn-` prefixed key not matching a known token still becomes a CSS variable on `html body`:

```yaml
stdn-sidebar-width: "280px"   # → --sidebar-width: 280px
stdn-card-radius: "8px"       # → --card-radius: 8px
```

### Reading mode

Control how a note opens on each visit:

```yaml
mode: read    # Reading mode (preview)
mode: edit    # Live Preview / editing
mode: raw     # Source mode (raw markdown)
```

If no `mode` key is set, the global **Default Reading Mode** setting applies.

### Publishing

```yaml
published: true   # Adds stnd-note-published body class — triggers aurora glow in UI
publish: true     # Marks the note for "Sync All Published Notes" command
```

`published` is a visual/UI flag — it adds a subtle glowing border to the active note so you can tell at a glance that a note is live.

`publish` is the sync flag — the **Sync All Published Notes** command collects every note with this key set and re-uploads them. The key name can optionally be prefixed via **Settings → Key Prefix**.

---

## Body classes

The plugin reflects the current view state as classes on `<body>`:

| Class | Active when |
|---|---|
| `stnd` | Plugin is loaded |
| `stdn-note` | A markdown note is open |
| `stdn-reading` | Note is in Reading mode |
| `stdn-editing` | Note is in Live Preview / editing |
| `stdn-canvas` | A Canvas file is active |
| `stdn-base` | A Bases file is active |
| `stdn-webviewer` | The built-in web viewer is open |
| `stdn-empty` | No file is open |
| `stdn-typography` | Typography layer is enabled in settings |
| `stdn-color` | Color layer is enabled in settings |
| `stdn-vertical-rhythm` | Vertical Rhythm layer is enabled |
| `cssclass-{name}` | Note has `{name}` in `cssclasses:` |
| `stnd-note-published` | Note has `published: true` in frontmatter |

Use these in theme or vault CSS to target specific modes or contexts:

```css
body.stnd-reading .markdown-preview-view {
  max-width: 680px;
  margin-inline: auto;
}

body.stnd-editing {
  --font-density: 1.1; /* tighter in edit mode */
}
```

---

## Settings

### Abstraction Layer

Optional CSS layers that activate design-token support.

| Setting | Body class |
|---|---|
| Typography | `stnd-typography` |
| Color | `stnd-color` |
| Vertical Rhythm | `stnd-vertical-rhythm` |

> Workspace niceties (auto-hide sidebars, reading-mode enforcement, system tray, minimalist mode) live in the **Atelier** plugin, not here.

---

## Commands

| Command | Description |
|---|---|
| Open Cheatsheet | Full frontmatter property reference in a modal. |
| Publish current note | Upload the active note to Standard Garden. |
| View live version | Open the published URL in browser or Obsidian web viewer. |
| Publish all notes | Publish every markdown file in the vault. |
| Sync all published notes | Re-upload all notes with a `publish:` frontmatter key. |

---

## Standard Garden

Connect to [standard.garden](https://standard.garden) to publish notes from your vault.

1. Get your API key from your Standard Garden account
2. Paste it in **Settings → API Key** — the plugin verifies it and shows your username
3. Publish with the ribbon icon or the command palette

On publish, wiki-links (`![[image.png]]`) and local image paths are automatically uploaded to the CDN and replaced with hosted URLs.

Live URL pattern: `standard.garden/@{username}/{note-name-slugified}`

### Ribbon icons (require API key)

| Icon | Action | Toggle in settings |
|---|---|---|
| Upload cloud | Publish current note | Publish Current Note |
| External link | View live version | View Live Version |
| Files | Publish all notes | Publish All Notes |
| Refresh | Sync all published | Sync All Notes |

### Options

| Setting | Description |
|---|---|
| Open After Publish | Automatically open the live URL after publishing. |
| Open in Obsidian Web Viewer | Open the live URL in a split pane instead of the system browser. |

---

## Examples

### Pick a theme

```yaml
---
theme: mono
---
```

### Mono-inspired look via frontmatter tokens

```yaml
font-text: "Space Mono"
font-header: "Inter"
font-monospace: "Space Mono"
font-density: 1.5
font-header-weight: 900
font-header-letter-spacing: "-0.07em"
color-light-foreground: "#100f0f"
color-light-background: "#fffcf0"
color-dark-foreground: "#fffcf0"
color-dark-background: "#100f0f"
```

Start from a `theme:` and override individual tokens to taste — per-note tokens always win.

---

## Installation

Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/standard/` in your vault, then enable the plugin.

To build and copy to your vault automatically:

```sh
pnpm run build
```
