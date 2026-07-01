# Standard Garden — Token Reference

All design tokens are set as **bare frontmatter keys** in any note. The key name _is_ the CSS variable name minus the `--` prefix. No namespace prefix, no translation layer.

```yaml
---
font-text: "Inter"
color-light-background: "#f5f0eb"
optical-ratio: 1.25
---
```

The canonical token list lives in `packages/utils/theme-tokens.js` and is shared by the web editor, the Obsidian plugin, and the static renderer.

---

## How it works

The plugin reads every frontmatter key, checks it against the canonical token set, and injects a matching CSS variable with `!important` on `html body` via `<style id="stnd-frontmatter">`.

```
font-header: "EB Garamond"   →   --font-header: "EB Garamond" !important
optical-ratio: 1.25           →   --optical-ratio: 1.25 !important
color-light-accent: "#b45309" →   --color-light-accent: #b45309 !important
```

The CSS layers (`stnd-typography`, `stnd-color`, `stnd-vertical-rhythm`) read those variables. No layer needs to be active for a token to be written — only for it to have a visual effect.

---

## Typography

> Requires **Settings → Typography** to be enabled.

| Frontmatter key | CSS variable | Controls |
|---|---|---|
| `font-text` | `--font-text` | Body text font. Auto-imports from Google Fonts. |
| `font-header` | `--font-header` | Heading font (H1–H6, inline title). Auto-imports. |
| `font-monospace` | `--font-monospace` | Code block font. Auto-imports. |
| `font-interface` | `--font-interface` | Obsidian UI font. Auto-imports. |
| `optical-ratio` | `--optical-ratio` | Modular type scale ratio (`1.333` = perfect fourth, `1.25` = major third). |
| `font-density` | `--font-density` | Line height multiplier for body text. |
| `line-width` | `--line-width` | Maximum line width (`35rlh`, `680px`, etc.). |
| `font-weight` | `--font-weight` | Body text weight. |
| `font-weight-bold` | `--font-weight-bold` | Bold text weight. |
| `font-header-weight` | `--font-header-weight` | Weight for all heading levels. |
| `font-header-letter-spacing` | `--font-header-letter-spacing` | Heading letter spacing (`-0.025em`). |
| `font-header-line-height` | `--font-header-line-height` | Heading line height. |
| `font-header-style` | `--font-header-style` | `normal` or `italic`. |
| `font-feature` | `--font-feature` | OpenType features for body (`"'liga', 'kern'"`). |
| `font-variation` | `--font-variation` | Variable font axes for body (`"'wght' 400"`). |
| `font-header-feature` | `--font-header-feature` | OpenType features for headings. |
| `font-header-variation` | `--font-header-variation` | Variable font axes for headings. |
| `font-monospace-feature` | `--font-monospace-feature` | OpenType features for code. |
| `font-monospace-variation` | `--font-monospace-variation` | Variable font axes for code. |
| `font-interface-feature` | `--font-interface-feature` | OpenType features for UI. |
| `font-interface-variation` | `--font-interface-variation` | Variable font axes for UI. |

### Example

```yaml
font-text: "EB Garamond"
font-header: "EB Garamond"
optical-ratio: 1.25
font-density: 1.8
line-width: "38rlh"
font-header-weight: 400
font-header-letter-spacing: "-0.02em"
```

---

## Colors — Light theme

> Requires **Settings → Color** to be enabled.

| Frontmatter key | CSS variable | Controls |
|---|---|---|
| `color-light-foreground` | `--color-light-foreground` | Primary text / foreground. |
| `color-light-background` | `--color-light-background` | Page background. |
| `color-light-accent` | `--color-light-accent` | Accent, links, interactive. |
| `color-light-red` | `--color-light-red` | Red palette. |
| `color-light-orange` | `--color-light-orange` | Orange palette. |
| `color-light-yellow` | `--color-light-yellow` | Yellow palette. |
| `color-light-green` | `--color-light-green` | Green palette. |
| `color-light-cyan` | `--color-light-cyan` | Cyan palette. |
| `color-light-blue` | `--color-light-blue` | Blue palette. |
| `color-light-purple` | `--color-light-purple` | Purple palette. |
| `color-light-pink` | `--color-light-pink` | Pink palette. |
| `color-light-bold` | `--color-light-bold` | Bold text in light mode. |
| `color-light-italic` | `--color-light-italic` | Italic text in light mode. |

---

## Colors — Dark theme

> Requires **Settings → Color** to be enabled.

Same structure, swap `-light-` for `-dark-`. Both sets can coexist in one note.

| Frontmatter key | CSS variable | Controls |
|---|---|---|
| `color-dark-foreground` | `--color-dark-foreground` | Primary text / foreground. |
| `color-dark-background` | `--color-dark-background` | Page background. |
| `color-dark-accent` | `--color-dark-accent` | Accent, links, interactive. |
| `color-dark-red` | `--color-dark-red` | Red palette. |
| `color-dark-orange` | `--color-dark-orange` | Orange palette. |
| `color-dark-yellow` | `--color-dark-yellow` | Yellow palette. |
| `color-dark-green` | `--color-dark-green` | Green palette. |
| `color-dark-cyan` | `--color-dark-cyan` | Cyan palette. |
| `color-dark-blue` | `--color-dark-blue` | Blue palette. |
| `color-dark-purple` | `--color-dark-purple` | Purple palette. |
| `color-dark-pink` | `--color-dark-pink` | Pink palette. |
| `color-dark-bold` | `--color-dark-bold` | Bold text in dark mode. |
| `color-dark-italic` | `--color-dark-italic` | Italic text in dark mode. |

### Example

```yaml
color-light-foreground: "#1c1917"
color-light-background: "#faf7f2"
color-light-accent: "#b45309"

color-dark-foreground: "#e8e3dc"
color-dark-background: "#1a1714"
color-dark-accent: "#d97706"
```

---

## Colors — Seeds (theme-agnostic)

These override both light and dark mode at once. Useful for quick single-palette notes.

| Frontmatter key | CSS variable | Overrides |
|---|---|---|
| `foreground` | `--foreground` | `--color-foreground` in both themes. |
| `background` | `--background` | `--color-background` in both themes. |
| `accent` | `--accent` | `--color-accent` in both themes. |

---

## Colors — Semantic

> Requires **Settings → Color** to be enabled.

| Frontmatter key | CSS variable | Controls |
|---|---|---|
| `color-accent` | `--color-accent` | Accent override (both themes). |
| `color-header` | `--color-header` | Heading text color. |
| `color-bold` | `--color-bold` | Bold text color in reading view. |
| `color-italic` | `--color-italic` | Italic text color in reading view. |

---

## Vertical Rhythm

> Requires **Settings → Vertical Rhythm** to be enabled.

| Frontmatter key | CSS variable | Controls |
|---|---|---|
| `margin` | `--margin` | Base spacing unit (`1rlh`, `1.5rem`, etc.). |
| `margin-block` | `--margin-block` | Block separation multiplier. Paragraphs get `margin × margin-block`. Default: `2`. |

### Example

```yaml
margin: "1rlh"
margin-block: 2.5
```

---

## Publishing

| Key | Value | Effect |
|---|---|---|
| `publish` | `true` / `false` | Marks the note as published. Set automatically when you hit **Publish**. Drives the Online / Excluded / Local badge. Adds `stnd-note-published` body class. |

---

## Body classes

The plugin reflects the current app state as classes on `<body>`.

| Class | Active when |
|---|---|
| `stnd` | Plugin is loaded. |
| `stnd-note` | A markdown note is open. |
| `stnd-reading` | Reading mode. |
| `stnd-editing` | Live Preview / editing. |
| `stnd-canvas` | A Canvas file is active. |
| `stnd-base` | A Bases file is active. |
| `stnd-webviewer` | Built-in web viewer is open. |
| `stnd-empty` | No file is open. |
| `stnd-typography` | Typography layer enabled. |
| `stnd-color` | Color layer enabled. |
| `stnd-vertical-rhythm` | Vertical Rhythm layer enabled. |
| `stnd-note-published` | Current note has `publish: true`. |
| `cssclass-{name}` | Note has `{name}` in `cssclasses:`. |

### Snippet example

```css
body.stnd-reading .markdown-preview-view {
  --file-line-width: 42rlh;
}

body.stnd-editing {
  --font-density: 1.4;
}

body.cssclass-wide .workspace-leaf-content {
  --file-line-width: 100%;
}
```

---

## CSS injection order

```
#stnd-global       ← vault-wide CSS (notes flagged with stnd:)
#stnd-note         ← per-session CSS (notes loaded via cssclasses:)
#stnd-frontmatter  ← CSS variables from token frontmatter keys
```

`#stnd-frontmatter` is last — token variables always win.

---

## Design principle

> **FM key === CSS property name minus `--`.**

No prefix. No aliasing. No translation layer. The frontmatter you write is the CSS variable you get, everywhere — Obsidian, standard.garden, static builds.