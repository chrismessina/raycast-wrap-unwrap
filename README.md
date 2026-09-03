<div align="center">

<img src="media/extension-icon.png" width="128" alt="Wrap Unwrap">

# Wrap Unwrap

[![Raycast Store](https://img.shields.io/badge/Raycast-Store-FF6363?style=flat-square&logo=raycast&logoColor=white)](https://www.raycast.com/chrismessina/wrap-unwrap)
[![Licence MIT](https://img.shields.io/badge/Licence-MIT-22C55E?style=flat-square)](LICENSE)
[![Follow @chrismessina](https://img.shields.io/github/followers/chrismessina?label=Follow%20chrismessina&style=social)](https://github.com/chrismessina)
[![Stars](https://img.shields.io/github/stars/chrismessina/raycast-wrap-unwrap?style=social)](https://github.com/chrismessina/raycast-wrap-unwrap/stargazers)

**Rewrap prose to a column, or flatten hard-wrapped text back into paragraphs — without mangling the Markdown around it.**

[Features](#features) • [Quick Start](#quick-start) • [Usage](#usage) • [How Reflow Works](#how-reflow-works) • [For Other Extensions](#for-other-extensions) • [Development](#development) • [Acknowledgements](#acknowledgements)

</div>

---

## Features

- **Two `no-view` commands** — Wrap Text and Unwrap Text run headless off a hotkey, transform the selection or clipboard, and paste the result straight back into whatever you were typing in. There is no UI to dismiss.
- **Markdown-aware, not regex-aware** — a line classifier tags every line as prose, list item, ATX or setext heading, fenced or indented code, blockquote, table row, HTML block, link reference definition, or horizontal rule. Only prose and list items are reflowed; everything else is re-emitted byte-for-byte.
- **Wrapping that cannot corrupt your text** — a break is rejected whenever the line it would produce reparses as something else. Breaking before a stray `-` would silently create a nested list item, and a wrapped-onto-its-own-line `>` reparses as an empty blockquote and deletes the token. Overrunning the column is treated as the lesser evil.
- **Atomic inline tokens** — code spans, inline and reference links, and autolinks are protected before fill, so `[some long label](https://example.com/a/b)` never gets split across two lines.
- **Blockquote and list structure survives the round trip** — reflow is grouped by blockquote prefix and inner role, so `> - item` stays a list item inside a quote. Continuation lines are re-indented to hang under the marker, with tabs measured at real 4-column tab stops rather than as one character.
- **Hard breaks are preserved** — a trailing two-space or backslash line break terminates the group and is re-attached to the last emitted line.
- **Soft-hyphen repair on unwrap** — a trailing U+00AD (the invisible optional-break character PDFs and word processors leave behind) is removed when lines are joined, while a real `-` is always kept, so `well-known` and `state-of-the-art` stay intact.
- **Bullet flattening for pasted junk** — optional re-indent of bullet and numbered lists to a clean 2-space-per-level step, preserving nesting depth by relative indent order. Unicode bullets (`•`, `‣`, `▪`, `▸`, `–`, `—`) are recognized, so text pasted out of a terminal or a rich-text editor becomes native Markdown.
- **A provider for other extensions** — both commands accept a `launchContext` and can hand the transformed text back to a callback command instead of pasting it.

---

## Quick Start

1. Open Raycast and search for **"Wrap Text"** or **"Unwrap Text"**.
2. Select some text in any app first, or copy it to the clipboard — the command reads the selection by default and falls back to the clipboard when there is no selection.
3. Run the command. The result is pasted into the focused app and a HUD confirms it (`Pasted wrapped text`).
4. Bind both to hotkeys — see [Suggested hotkeys](#suggested-hotkeys). These commands are far more useful on a keystroke than through the Raycast search bar.

If neither the selection nor the clipboard has text, you get a failure toast with a **Copy Error** action rather than a silent no-op. Input above 1,000,000 characters is refused for the same reason.

---

## Usage

### Commands

| Command | Mode | Description |
| --- | --- | --- |
| Wrap Text | `no-view` | Wrap text at a configurable column width. |
| Unwrap Text | `no-view` | Reflow wrapped text into continuous paragraphs while preserving Markdown structure. |

### Shared Preferences

Both commands share these four:

| Preference | Values | Default | What it does |
| --- | --- | --- | --- |
| Preferred Source | Selected Text / Clipboard | Selected Text | Which source to try first. The other is used as a fallback when the first is empty, so the default reads your selection and falls back to the clipboard. |
| Primary Action | Paste / Copy | Paste | Paste the result into the focused app, or leave it on the clipboard. |
| Hide HUD | checkbox | off | Suppress the success HUD (`Pasted wrapped text` / `Copied unwrapped text`). |
| Pop to Root After Action | checkbox | off | Return to the Raycast root after the action. No-op when launched by hotkey with no Raycast UI visible. |

### Wrap Text

| Preference | Values | Default | What it does |
| --- | --- | --- | --- |
| Wrap Column | integer | `80` | The column to wrap at. The budget is the **full** line including blockquote and list-item prefixes, so a quoted list item still ends at your column. Values below 20 are clamped to 20; anything that is not a whole number falls back to 80. |

### Unwrap Text

| Preference | Values | Default | What it does |
| --- | --- | --- | --- |
| Strip Soft Hyphens | checkbox | on | Drop a trailing soft hyphen (U+00AD) when joining lines. A regular `-` is always kept — `well-` + `known` rejoins as `well-known`, and either way the halves join with no space. |
| Keep Blank Lines | checkbox | off | Preserve blank lines between paragraphs instead of collapsing runs of them. |
| Strip Bullet Indentation | checkbox | off | Re-indent bullets and numbered lists to a fixed 2-space-per-level step, removing the leading spaces pasted terminal or rich-text content carries in front of markers. Nesting depth is preserved by relative indent order. |

### Suggested hotkeys

Bind these in Raycast → Extensions → Wrap Unwrap:

- Wrap Text → <kbd>⌃</kbd><kbd>⌥</kbd><kbd>W</kbd>
- Unwrap Text → <kbd>⌃</kbd><kbd>⌥</kbd><kbd>U</kbd>

---

## How Reflow Works

Both commands run the same three stages: classify every line, reflow only the lines that are safe to reflow, then re-emit.

### What gets reflowed, and what does not

Every line is tagged with a blockquote prefix stack and an inner role. Only **prose** and **list-item** are rewritten. These roles pass through verbatim:

| Role | Example |
| --- | --- |
| Fenced code and its boundaries | ```` ```ts ```` … ```` ``` ```` |
| Indented code | four-space-indented blocks, when not inside an open list item |
| ATX and setext headings | `## Title`, or a line followed by `---` / `===` |
| Table rows | any row in a block containing a `\| --- \|` separator |
| HTML blocks | `<div>` … |
| Link reference definitions | `[id]: https://example.com` |
| Horizontal rules | `---`, `***`, `___` |

Lines are grouped for reflow only while the blockquote prefix stack matches and no blank line, hard break, or role change intervenes — which is why `> - item` reflows as a list item *inside* a quote instead of being hoisted out of it.

### Wrapping

Greedy word fill against a per-line budget. Two details make it safe rather than naive:

- **The budget is display width, not character count.** A tab is one character but advances to the next 4-column stop, so tab-indented content used to overrun the requested column. Prefixes are measured in columns.
- **A break that would change the parse is refused.** Before committing to a break, the candidate next line is classified. If it would come back as anything but prose — a list marker, a fence, a blockquote, a setext underline — the token stays on the current line and the width is overrun instead. Losing a column beats losing a character.

Continuation lines of a list item are indented to clear the marker, gap, and task checkbox, reusing the item's literal indent so alignment holds at any tab width.

### Unwrapping

Lines in a group are joined with a single space, except:

- **Soft hyphens** — a trailing U+00AD is dropped and the halves joined tight (when Strip Soft Hyphens is on). A literal `-` is never removed.
- **Open inline constructs** — the joiner tracks whether the text so far ends inside an unterminated code span or link destination, honouring backslash escapes, multi-tick fences (`` ``a`b`` ``), and balanced parens inside a URL. A line ending mid-URL is joined tight rather than having a space injected into the destination.

---

## For Other Extensions

Wrap Unwrap implements the [LitoMore cross-extension convention](https://github.com/LitoMore/raycast-cross-extension-conventions) on the provider side, using only built-in Raycast SDK primitives. Pass a `launchContext` with the text and an optional `callbackLaunchOptions` describing where to send the result:

```ts
import { launchCommand, LaunchType } from "@raycast/api";

await launchCommand({
  name: "unwrap-text",
  type: LaunchType.UserInitiated,
  extensionName: "wrap-unwrap",
  ownerOrAuthorName: "chrismessina",
  context: {
    text: "Some\nwrapped\ntext\nto reflow",
    hyphenation: true,
    callbackLaunchOptions: {
      name: "your-callback-command",
      type: LaunchType.Background,
      extensionName: "your-extension",
      ownerOrAuthorName: "you",
    },
  },
});
```

Your callback command is invoked with `context: { result: "..." }` holding the transformed text. When `callbackLaunchOptions` is present the provider does **not** paste, copy, or show a HUD — it just hands the result back.

| Context | Accepts |
| --- | --- |
| `WrapContext` | `text`, `width`, `callbackLaunchOptions` |
| `UnwrapContext` | `text`, `hyphenation`, `keepBlankLines`, `flattenBullets`, `callbackLaunchOptions` |

Every context field overrides the corresponding user preference for that invocation. `text` falls back to the user's Preferred Source when omitted. Note that `width` supplied here bypasses the preference parser, so pass a sane integer.

---

## Development

### Project Structure

```
raycast-wrap-unwrap/
├── src/
│   ├── wrap-text.ts       # Wrap Text command entry point
│   ├── unwrap-text.ts     # Unwrap Text command entry point
│   └── lib/
│       ├── classify.ts    # Line → blockquote prefix stack + inner role
│       ├── wrap.ts        # Greedy fill with block-safe break rejection
│       ├── unwrap.ts      # Group joining, hyphenation, bullet flattening
│       ├── inline.ts      # Placeholder protection for atomic inline tokens
│       ├── regex.ts       # Shared block and inline patterns
│       └── pipeline.ts    # Input, size guard, delivery, failure toasts
├── test/                  # node:test suites
├── test-fixtures/         # 14 Markdown fixtures covering each block role
├── assets/                # Extension icon (runtime)
├── media/                 # README images
└── package.json
```

### Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start in development mode with hot reload |
| `npm run build` | Build for production |
| `npm run lint` | Run Raycast ESLint config |
| `npm run fix-lint` | Auto-fix lint issues |
| `npm test` | Run the `node:test` suites via `tsx` |
| `npm run publish` | Publish to the Raycast Store |

### Clone & Run

```sh
git clone https://github.com/chrismessina/raycast-wrap-unwrap.git
cd raycast-wrap-unwrap
npm install
npm run dev
```

---

## Acknowledgements

The Preferred Source / Primary Action preference pattern follows the popular [Change Case](https://www.raycast.com/erics118/change-case) extension's convention.

---

MIT © [Chris Messina](https://github.com/chrismessina)
