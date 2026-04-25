# Wrap / Unwrap — Design

**Date:** 2026-04-25
**Status:** Approved (pending user review of this document)

## Goal

A Raycast extension with two `no-view` commands — **Wrap Text** and **Unwrap Text** — that transform text from the user's selection or clipboard and deliver the result back, using the same source/action conventions as the popular Change Case extension. Designed to be hotkey-driven so users can wrap or reflow text inline without leaving the surrounding application.

## Non-goals

- AI tools (`tools/`) — punted to a later enhancement.
- A view-mode preview UI — both commands are `no-view`; users rely on `cmd-z` for accidents.
- Bidirectional round-tripping. Unwrap is a destructive transform; we don't promise that `wrap(unwrap(x)) === x`.
- Soft-wrapping for languages other than Markdown-flavored prose. Code, tables, and HTML blocks are passed through untouched.

## Commands

Two `no-view` commands declared in `package.json` `commands[]`:

| name | title | description |
| --- | --- | --- |
| `wrap-text` | Wrap Text | Wrap text at a configurable column width. |
| `unwrap-text` | Unwrap Text | Reflow wrapped text into continuous paragraphs while preserving Markdown structure. |

Each command's entry file (`src/wrap-text.ts`, `src/unwrap-text.ts`) is a thin wrapper that:

1. Reads preferences and `launchContext`.
2. Acquires input.
3. Guards size.
4. Calls the appropriate transform from `src/lib/`.
5. Delivers output.

## Pipeline

```
acquire input → guard size → transform → deliver output
```

The pipeline shape is shared between both commands; only the transform step differs. The shared scaffolding lives in `src/lib/pipeline.ts`.

### Acquire input

Mirrors Change Case's `readContent`. Order is determined by the `source` preference:

```ts
async function getSelection(): Promise<string> {
  try { return await getSelectedText(); } catch { return ""; }
}

async function readContent(preferredSource: "selection" | "clipboard"): Promise<string> {
  const clipboard = await Clipboard.readText();
  const selected  = await getSelection();
  if (preferredSource === "clipboard") {
    if (clipboard) return clipboard;
    if (selected)  return selected;
  } else {
    if (selected)  return selected;
    if (clipboard) return clipboard;
  }
  throw new NoTextError();
}
```

When the command is launched cross-extension with `launchContext.text`, that input wins and `readContent` is skipped entirely.

### Guard size

`MAX_INPUT = 1_000_000` chars. If input exceeds the cap, show a failure toast (`"Text exceeds 1MB limit. Use a text editor for documents this large."`) and exit. This is a hard cap with no override; if it bites a real user, they can file an issue and we'll reconsider.

### Transform

- **Wrap:** `wrap(text, { width })` — described in §"Wrap algorithm" below.
- **Unwrap:** `unwrap(text, { hyphenation, keepBlankLines })` — described in §"Unwrap algorithm" below.

### Deliver output

Same routing pattern as Change Case's `immediatelyConvert` branch:

```ts
if (props.launchContext?.callbackLaunchOptions) {
  await callbackLaunchCommand(props.launchContext.callbackLaunchOptions, { result });
  return;
}
if (prefs.action === "paste") await Clipboard.paste(result);
else                          await Clipboard.copy(result);
if (!prefs.hideHUD) await showHUD(/* see below */);
if (prefs.popToRoot) await popToRoot();
```

HUD copy:

| command | action=paste | action=copy |
| --- | --- | --- |
| wrap | `Pasted wrapped text` | `Copied wrapped text` |
| unwrap | `Pasted unwrapped text` | `Copied unwrapped text` |

Errors:

- `NoTextError` → `showToast({ style: Failure, title: "No text available", message: "Select text or copy it to the clipboard." })`
- Input exceeds `MAX_INPUT` → `showToast({ style: Failure, title: "Text exceeds 1MB limit", message: "Use a text editor for documents this large." })` — handled before the transform runs, not via `showFailureToast`.
- Anything else → `showFailureToast(error, { title: "Failed to wrap text" })` (or "unwrap").

## Preferences

Declared per command (Raycast preferences are per-command, even when shared by name) so each command can be hotkey-bound with its own defaults.

### Shared (both commands)

| name | type | default | label | description |
| --- | --- | --- | --- | --- |
| `source` | dropdown (`selection` / `clipboard`) | `selection` | Preferred Source | Choose a preferred text source. If no text is found there, the other is used. |
| `action` | dropdown (`paste` / `copy`) | `paste` | Primary Action | Choose whether the primary action should copy or paste the output. |
| `hideHUD` | checkbox | `false` | Hide HUD | Suppress the success HUD after the action completes. |
| `popToRoot` | checkbox | `false` | Pop to Root After Action | Return to Raycast root after completing the action. (No-op when launched via hotkey with no Raycast UI visible.) |

### Wrap-only

| name | type | default | label | description |
| --- | --- | --- | --- | --- |
| `width` | textfield | `80` | Wrap Column | Wrap lines at this column. Must be a positive integer; falls back to `80` on invalid input. |

### Unwrap-only

| name | type | default | label | description |
| --- | --- | --- | --- | --- |
| `hyphenation` | checkbox | `true` | Strip Soft Hyphens | When joining lines, remove a trailing `-` if it appears to be a soft line-break hyphen. |
| `keepBlankLines` | checkbox | `false` | Keep Blank Lines | Preserve blank lines between paragraphs instead of collapsing runs. |

`Preferences` types are auto-generated by Raycast — never hand-write them.

## Wrap algorithm

`wrap(text, { width })`:

1. Split into roles using the same classifier as Unwrap (see §"Line classifier"). This is so we know which regions are reflow-safe (`prose`, `list-item`, `blockquote` content) vs. preserve-as-is (`fence-boundary`, `in-fence`, `indented-code`, `heading-atx`, `heading-setext`, `hr`, `table-row`, `html-block`, `link-ref-def`).
2. For each reflow-safe region, collect its content into one logical line, then re-wrap at `width` columns using a greedy word-fill that:
   - Tokenizes the line preserving inline code spans (`` `…` ``) and inline links (`[text](url)`) as atomic — never broken across lines.
   - Breaks on whitespace.
   - Re-emits the appropriate prefix (list marker hang indent, blockquote `> ` chain) on each output line.
3. For preserve-as-is regions, emit lines verbatim.

Edge cases:

- A single token longer than `width` is emitted on its own line (no mid-word break).
- `width < 20` is clamped to `20` defensively.
- An invalid `width` preference (NaN, ≤0) falls back to `80`.

## Unwrap algorithm

`unwrap(text, { hyphenation, keepBlankLines })`:

1. Normalize line endings (CRLF/CR → LF).
2. Run the line classifier (see below) to assign each line a role.
3. Group consecutive joinable lines (`prose`, `list-item` continuations, `blockquote` content of matching depth) into reflow groups.
4. For each reflow group, join with single spaces, applying the hyphenation rule if enabled.
5. Re-emit each group's lines with the original prefix (blockquote chain, list marker + hang).
6. Preserve-as-is roles are passed through untouched.
7. If `keepBlankLines` is on, every blank line in the input becomes a blank line in the output. If off, runs of blank lines collapse to a single blank line.

### Hyphenation rule

When `hyphenation: true`, while joining two `prose` lines:

- If the prior line ends with `[a-z]-` (lowercase letter followed by hyphen at end of line) AND the next line begins with `[a-z]`, drop the hyphen and join with no space.
- Otherwise, keep the hyphen and join with a single space.

This preserves intentional compounds like `state-of-the-art` while cleaning up `inter-\nesting` → `interesting`.

### Inline preservation

Within a reflow group, before joining, tokenize each line and protect:

- Inline code spans: `` `…` `` (backtick-delimited, including double-backtick spans).
- Inline links: `[text](url)` and reference links `[text][id]`.
- Autolinks: `<https://…>`, `<email@…>`.

Protected tokens are replaced with placeholders during the join, then restored. This guarantees no spaces are inserted inside a code span or URL.

## Line classifier

Single-pass classification with two-line lookahead (needed for setext headings). Each line gets one of:

| role | recognizer (line-level, after `\r` normalization) |
| --- | --- |
| `blank` | line is empty or whitespace-only |
| `fence-boundary` | `^(\s{0,3})(\`{3,}\|~{3,})` — toggles `in-fence`; closer must match opener char + length |
| `in-fence` | classifier state, set by previous fence-boundary |
| `indented-code` | `^ {4,}\S` AND prior non-blank line is not a list-item (otherwise it's a list-item continuation) |
| `heading-atx` | `^(\s{0,3})#{1,6}\s` |
| `heading-setext` | the *next* line matches `^(=+\|-+)\s*$`, current line is non-blank prose, and current line is not itself a list-item or other special role; the underline line is also classified as `heading-setext` |
| `hr` | `^(\s{0,3})([-*_])(?:\s*\2){2,}\s*$` (3+ of the same char, optional internal spaces) |
| `blockquote` | `^(\s{0,3})>` — depth = count of `>` characters at start (with optional intervening spaces) |
| `list-item` | `^(\s*)([-*+]\|\d{1,9}[.)])(\s+)` (the `\d{1,9}` matches CommonMark's 9-digit cap) |
| `task-item` | a `list-item` whose remainder begins with `\[[ xX]\]\s` (handled as a list-item with a marker variant) |
| `table-row` | line contains a pipe AND we've previously seen a separator row matching `^(\s*)\\|?(\s*:?-+:?\s*\\|)+\s*:?-+:?\s*\\|?\s*$`, OR is itself such a separator row, OR is the row immediately before such a separator |
| `html-block` | line begins with `<` followed by a known block-level tag name OR a comment `<!--` (CommonMark §4.6) |
| `link-ref-def` | `^(\s{0,3})\[[^\]]+\]:\s+\S` (definition for reference-style link or footnote) |
| `hard-break` | a `prose` line ending in `  +$` (2+ trailing spaces) or a single trailing `\\` |
| `prose` | anything else |

Setext detection requires looking at the *next* line: when classifying line `i`, peek at line `i+1`'s underline pattern. The classifier produces `(role, prefix, content, depth)` tuples for each line so the reflower has everything it needs.

### Critical regex notes

These were flagged for careful review:

- **List markers:** `^(\s*)([-*+]|\d{1,9}[.)])(\s+)` — `\d{1,9}` not `\d+` (CommonMark cap), `[.)]` accepts both `1.` and `1)`, capturing the trailing whitespace as group 3 so we know the hang-indent column.
- **Hyphen-join:** `[a-z]-$` on prior line, `^[a-z]` on next. NOT `\w` — that would match digits.
- **Hard break:** `/  +$/` — must be applied before any whitespace trimming.
- **Setext underline:** `^(=+|-+)\s*$` — but only counts as a heading when the prior line is non-blank prose and not itself a special role.
- **HR:** `^(\s{0,3})([-*_])(?:\s*\2){2,}\s*$` — 3+ of the same char, allows internal spaces, captures the char to ensure consistency.
- **Fence:** opener and closer must match char (`` ` `` vs `~`) and the closer's length must be `>=` opener's length.
- **Blockquote depth:** count `>` characters at start, allowing optional single space between them. Nested-quote reflow groups by depth.

Each regex will be defined as a named `const` in `src/lib/regex.ts` with a comment showing example matches and counter-examples.

## File layout

```
src/
  wrap-text.ts            # entry point — pipeline scaffolding + wrap
  unwrap-text.ts          # entry point — pipeline scaffolding + unwrap
  lib/
    pipeline.ts           # readContent, NoTextError, deliver, size guard
    classify.ts           # line classifier (roles, prefixes, content)
    regex.ts              # named regex constants with examples
    wrap.ts               # wrap(text, opts)
    unwrap.ts             # unwrap(text, opts)
    inline.ts             # inline-token tokenize/restore (code spans, links)

test-fixtures/            # markdown files for manual eval (see below)
```

The two entry files should be < 50 lines each. Almost all logic lives in `lib/`.

## Cross-extension contract

Both commands accept `LaunchProps<{ launchContext?: WrapContext | UnwrapContext }>`:

```ts
type WrapContext = {
  text?: string;                            // if absent, fall back to readContent
  width?: number;                           // overrides width preference
  callbackLaunchOptions?: LaunchOptions;    // if present, return result via callbackLaunchCommand
};

type UnwrapContext = {
  text?: string;
  hyphenation?: boolean;                    // overrides preference
  keepBlankLines?: boolean;                 // overrides preference
  callbackLaunchOptions?: LaunchOptions;
};
```

When `callbackLaunchOptions` is present, the command always returns via `callbackLaunchCommand(callbackLaunchOptions, { result })` and does NOT paste, copy, or HUD. This is the "always callback when launched cross-extension" simplification agreed during brainstorming.

We use the `raycast-cross-extension` community package for `crossLaunchCommand`/`callbackLaunchCommand` typings.

## README

Top-level `README.md` covers:

- One-paragraph intro: what Wrap / Unwrap is, when to use it.
- Command list with descriptions.
- Preferences table (matches the table above).
- Suggested hotkeys (e.g. ⌃⌥W for wrap, ⌃⌥U for unwrap — purely a suggestion).
- "For other extensions" — the `WrapContext` / `UnwrapContext` shape and a `crossLaunchCommand` example.
- Acknowledgement that the source/action pattern follows the Change Case extension's convention.

## Test fixtures

`test-fixtures/` directory with one `.md` file per role plus combination files. Each file has a header block (HTML-comment) describing the input shape and expected behavior.

| file | covers |
| --- | --- |
| `01-prose-paragraphs.md` | basic prose with multiple paragraphs |
| `02-headings.md` | ATX (`#`) and setext (`===`/`---`) headings interleaved with prose |
| `03-bullets-and-lists.md` | `-`, `*`, `+`, ordered (`1.`, `1)`), task lists `- [ ]`, nested |
| `04-blockquotes.md` | single-level `>`, nested `> >`, quote-with-list |
| `05-fenced-code.md` | ` ``` ` and `~~~` fences with wrapped-looking content (must NOT reflow) |
| `06-indented-code.md` | 4-space indented code, mixed with prose |
| `07-inline-code-and-links.md` | prose with `` `code` ``, `[link](url)`, autolinks |
| `08-tables.md` | pipe tables |
| `09-html-blocks.md` | `<div>...</div>`, comments |
| `10-link-ref-defs.md` | reference-style links + footnote definitions |
| `11-hyphenation.md` | soft hyphens (`inter-\nesting`) and intentional compounds (`state-\nof-the-art`) |
| `12-hard-breaks.md` | trailing-two-spaces, trailing `\` |
| `13-mixed-realistic.md` | a realistic doc combining most of the above |
| `14-edge-cases.md` | empty input, single blank line, whitespace-only line, mixed CRLF, very long single line, no trailing newline |

These are for manual evaluation: paste a fixture into a buffer, run Unwrap (or Wrap), eyeball the result. Expected behaviors are documented inline so the user can judge correctness without reading the algorithm.

## Open follow-ups (not part of v1)

- AI tools (`tools/wrap.ts`, `tools/unwrap.ts`) once the core transform is validated against fixtures.
- Per-command argument support (`width` as a Raycast `arguments[]` value for one-off overrides).
- "Sentence per line" wrap mode.
- Localization / CJK width awareness.
