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

| name          | title       | description                                                                         |
| ------------- | ----------- | ----------------------------------------------------------------------------------- |
| `wrap-text`   | Wrap Text   | Wrap text at a configurable column width.                                           |
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
  try {
    return await getSelectedText();
  } catch {
    return "";
  }
}

async function readContent(
  preferredSource: "selection" | "clipboard",
): Promise<string> {
  const clipboard = await Clipboard.readText();
  const selected = await getSelection();
  if (preferredSource === "clipboard") {
    if (clipboard) return clipboard;
    if (selected) return selected;
  } else {
    if (selected) return selected;
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
  await launchCommand({
    ...props.launchContext.callbackLaunchOptions,
    context: { result },
  });
  return;
}
if (prefs.action === "paste") await Clipboard.paste(result);
else await Clipboard.copy(result);
if (!prefs.hideHUD) await showHUD(/* see below */);
if (prefs.popToRoot) await popToRoot();
```

HUD copy:

| command | action=paste            | action=copy             |
| ------- | ----------------------- | ----------------------- |
| wrap    | `Pasted wrapped text`   | `Copied wrapped text`   |
| unwrap  | `Pasted unwrapped text` | `Copied unwrapped text` |

### Error toasts

Every failure toast in this extension must include a **Copy Error** `primaryAction` so the user can grab the error message without screenshotting. This applies to expected failures (`NoTextError`, size cap) AND unexpected ones (caught by the outer `catch`).

Shape:

```ts
async function failureToast(title: string, message: string) {
  await showToast({
    style: Toast.Style.Failure,
    title,
    message,
    primaryAction: {
      title: "Copy Error",
      onAction: async () => {
        await Clipboard.copy(`${title}: ${message}`);
      },
    },
  });
}
```

Cases:

- `NoTextError` → `failureToast("No text available", "Select text or copy it to the clipboard.")`
- Input exceeds `MAX_INPUT` → `failureToast("Text exceeds 1MB limit", "Use a text editor for documents this large.")` — handled before the transform runs.
- Anything else → caught by the outer `try`/`catch`; extract `error instanceof Error ? error.message : "Unknown error"` into `message`, then `failureToast("Failed to wrap text", message)` (or "Failed to unwrap text").

We do NOT use `showFailureToast` from `@raycast/utils` because the Copy Error contract is uniform across all three cases and a small local helper is clearer than threading `primaryAction` through `showFailureToast`'s options.

### Type & API rules (enforced)

- **Never hand-write `Preferences` or `Arguments` types.** Raycast auto-generates these from `package.json`. Use `getPreferenceValues<Preferences>()` and `LaunchProps<{ arguments: Arguments.CommandName }>` with the generated types directly.
- **No `any` casts.** Use proper types, `unknown`, or generics. The `launchContext` shapes (`WrapContext`, `UnwrapContext`) are the only places we hand-define types, and those are the cross-extension contract — not Raycast-generated.

## Preferences

Per the [Raycast manifest docs](https://developers.raycast.com/information/manifest), commands "automatically inherit extension preferences and can override entries with the same `name`." So the four shared preferences live at the **extension level** (top-level `preferences[]` in `package.json`) and each command declares only its own command-specific ones in `commands[].preferences[]`. Both commands inherit Source, Action, Hide HUD, and Pop to Root automatically.

Preferences are accessed via `getPreferenceValues<Preferences>()` — the `Preferences` type is auto-generated by Raycast from the manifest and must not be hand-written.

All snippets below are literal `package.json` entries.

### Extension-level (inherited by both commands)

```json
[
  {
    "name": "source",
    "title": "Preferred Source",
    "description": "Choose a preferred text source. If no text is found there, the other is used.",
    "type": "dropdown",
    "required": false,
    "default": "selection",
    "data": [
      { "title": "Selected Text", "value": "selection" },
      { "title": "Clipboard", "value": "clipboard" }
    ]
  },
  {
    "name": "action",
    "title": "Primary Action",
    "description": "Choose whether the primary action should copy or paste the output.",
    "type": "dropdown",
    "required": false,
    "default": "paste",
    "data": [
      { "title": "Paste", "value": "paste" },
      { "title": "Copy", "value": "copy" }
    ]
  },
  {
    "name": "hideHUD",
    "title": "HUD",
    "description": "Suppress the success HUD after the action completes.",
    "type": "checkbox",
    "required": false,
    "default": false,
    "label": "Hide HUD"
  },
  {
    "name": "popToRoot",
    "title": "After Action",
    "description": "Return to Raycast root after completing the action. No-op when launched via hotkey with no Raycast UI visible.",
    "type": "checkbox",
    "required": false,
    "default": false,
    "label": "Pop to Root After Action"
  }
]
```

### Wrap-only

```json
{
  "name": "width",
  "title": "Wrap Column",
  "description": "Wrap lines at this column. Must be a positive integer; falls back to 80 on invalid input.",
  "type": "textfield",
  "required": false,
  "default": "80",
  "placeholder": "80"
}
```

`textfield` returns a `string`; the entry-point code parses it with `parseInt`, validates `> 0`, and falls back to `80` on `NaN`/non-positive values.

### Unwrap-only

```json
[
  {
    "name": "hyphenation",
    "title": "Hyphenation",
    "description": "When joining lines, remove a trailing hyphen if it appears to be a soft line-break hyphen (e.g., `inter-` + `esting` becomes `interesting`).",
    "type": "checkbox",
    "required": false,
    "default": true,
    "label": "Strip Soft Hyphens"
  },
  {
    "name": "keepBlankLines",
    "title": "Blank Lines",
    "description": "Preserve blank lines between paragraphs instead of collapsing runs.",
    "type": "checkbox",
    "required": false,
    "default": false,
    "label": "Keep Blank Lines"
  }
]
```

## Wrap algorithm

`wrap(text, { width })`:

1. Split into roles using the same classifier as Unwrap (see §"Line classifier"). This identifies reflow-safe inner roles (`prose`, `list-item`) — which may sit under any blockquote prefix stack — vs. preserve-as-is inner roles (`fence-boundary`, `in-fence`, `indented-code`, `heading-atx`, `heading-setext`, `hr`, `table-row`, `html-block`, `link-ref-def`).
2. For each reflow-safe region, collect its content into one logical line, then re-wrap so each emitted line satisfies the width contract below.
3. For preserve-as-is regions, emit lines verbatim — even if longer than `width`.

### Width contract

`width` is the **maximum length of the entire emitted line**, including every prefix character (blockquote markers, list markers, hang indentation). That is the user-visible column count and matches `prettier --prose-wrap`, `mdformat`, and `fmt(1)`.

For each output line in a reflow region, the budget for content is `width - prefixLen`, where `prefixLen` is the rendered length of:

- The blockquote prefix stack (e.g. `> > ` is 4 chars at depth 2).
- Plus, for the first output line of a list item: the list marker + its trailing space (e.g. `- ` is 2 chars; `1. ` is 3; `- [ ] ` is 6 for a task item).
- Plus, for continuation lines of a list item: hang indentation matching the marker width (so wrapped list-item content aligns under the first content character).

Example, `width = 40`, input `> - A long bullet that needs reflowing`:

```
> - A long bullet that needs
>   reflowing
```

Both lines are ≤ 40 chars. The first uses prefix `> - ` (4) leaving 36 for content; the second uses prefix `>   ` (4 — quote marker plus 2-space hang) leaving 36 for content.

### Greedy word fill

For each reflow region, after computing the prefix and per-line content budget:

- Tokenize content preserving inline code spans (`` `…` ``), inline links (`[text](url)` and `[text][id]`), and autolinks (`<…>`) as atomic — never broken across lines.
- Walk tokens left-to-right; pack tokens onto the current line, joining with single spaces, until adding the next token would exceed the line's budget. Then emit the line and start a new one with the continuation prefix.

### Edge cases

- **Token longer than budget:** emit it alone on its own line. The line will exceed `width`; that's acceptable (no mid-token break, since breaking inside `[link](https://very-long-url)` or `` `inline_code_with_no_spaces` `` would corrupt the markup).
- **Prefix alone ≥ width:** the line cannot be wrapped meaningfully (e.g. a deeply nested blockquote with `width = 30` and prefix length 32). Degenerate fallback: emit one token per line. The lines will exceed `width`; this is the least-bad outcome.
- **`width < 20`:** clamp to `20` defensively.
- **Invalid `width` preference (NaN, ≤ 0):** fall back to `80`.
- **Hard-break-terminated lines** (input has a hard break — see classifier): preserve the hard break on the *last* output line of that input span; it does not influence the budget calculation.

## Unwrap algorithm

`unwrap(text, { hyphenation, keepBlankLines })`:

1. Normalize line endings (CRLF/CR → LF).
2. Run the line classifier (see below). Each line yields a `Classified` record (see §"Classifier output shape" for the exact type).
3. Group consecutive joinable lines into reflow groups. Two lines belong to the same group iff:
   - Their **blockquote prefix stacks are identical** (same depth, same per-frame marker).
   - Their **inner roles compose** — see §"Reflow-group rules" below.
   - Neither line is preceded by a hard-break terminator (see §"Hard-break handling").
4. For each reflow group, join the content with single spaces, applying the hyphenation rule if enabled.
5. Re-emit each group's lines with the original prefix stack reconstructed (blockquote chain + list marker + hang for the first line of a list item; blockquote chain + hang indent for continuation lines).
6. Preserve-as-is roles (`fence-boundary`, `in-fence`, `indented-code`, `heading-atx`, `heading-setext`, `hr`, `table-row`, `html-block`, `link-ref-def`) are passed through untouched.
7. If `keepBlankLines` is on, every blank line in the input becomes a blank line in the output. If off, runs of blank lines collapse to a single blank line.

### Reflow-group rules

| previous inner role | current inner role | grouped? |
| --- | --- | --- |
| `prose` | `prose` | yes |
| `list-item` | `prose` (continuation, sufficient indent) | yes — current is treated as a continuation of the list item |
| `list-item` | `list-item` (different marker, same indent) | no — new list item starts a new group |
| any | `blank` | no — paragraph break |
| any | preserve-as-is role | no — boundary |

A `prose` line counts as a list-item continuation when its leading indentation is ≥ the parent list item's hang-indent column. CommonMark's "lazy continuation" (continuation without sufficient indent) is also recognized for unwrap purposes — if the prior line is a list-item and the current `prose` line has zero indent and no intervening blank, treat it as continuation. This matches what users typically write.

### Hard-break handling

A line classified with the `hardBreak` flag set (trailing 2+ spaces or trailing `\`) **terminates its reflow group** — joining stops, the line is emitted with its hard-break marker preserved verbatim, and the next non-blank line starts a fresh reflow group. This applies to both wrap and unwrap:

- **Unwrap:** the line is the LAST line included in its current group's join. The trailing `  ` or `\` is kept on output, followed by a literal newline; the following line begins a new group.
- **Wrap:** for an input span being re-wrapped, a hard break in the source is preserved at the position it appeared on the *last* output line of the corresponding content. (In practice this means: when reflowing a span that contains a hard break, split the span at the hard break, wrap each piece independently, and emit the hard-break marker at the end of the piece that contained it.)

### Hyphenation rule

When `hyphenation: true`, while joining two `prose` lines, the prior line is checked for a soft hyphen at end-of-line. The check uses `HYPHEN_BREAK_END = /(?:^|[^A-Za-z-])[a-z]+-$/` — a run of lowercase letters immediately before the trailing hyphen, where the run is NOT preceded by another letter or a hyphen. The next line must begin with `[a-z]`.

If the regex matches AND the next line starts with a lowercase letter, drop the hyphen and join with no space. Otherwise, keep the hyphen and join with a single space.

Cases:

- `inter-` + `esting` → matches (start-of-string before `inter`) → `interesting`. ✓
- `State-` + `wide` → no match (capital `S` is `[A-Za-z]`, excluded) → `State- wide`. (Capital-led words preserve the hyphen.)
- `123-` + `something` → no match (no `[a-z]+` run before `-`) → `123- something`.
- `state-of-the-` + `art` → no match (the `the` run is preceded by `-`, excluded) → `state-of-the- art`. **Known v1 limitation:** mid-compound line breaks gain a space. Workaround: turn hyphenation off (`Strip Soft Hyphens` preference) for documents with hyphenated compounds split across lines.

This preserves the common case (`inter-`-style soft breaks) while avoiding the most jarring incorrect strips (capital-led words, digits). The compound-mid-break case is rare in practice and accepted as a follow-up.

### Inline preservation

Within a reflow group, before joining, tokenize each line and protect:

- Inline code spans: `` `…` `` (backtick-delimited, including double-backtick spans).
- Inline links: `[text](url)` and reference links `[text][id]`.
- Autolinks: `<https://…>`, `<email@…>`.

Protected tokens are replaced with placeholders during the join, then restored. This guarantees no spaces are inserted inside a code span or URL.

## Line classifier

Single-pass classification with two-line lookahead (needed for setext headings). Lines are CRLF/CR-normalized to LF before classification.

### Classifier output shape

Markdown prefixes compose: a line like `> - item` is a blockquote AROUND a list item, not just one or the other. A flat single-role enum would lose that structure and break list-item hang indentation under quotes. So the classifier strips prefixes recursively and returns:

```ts
type BlockquoteFrame = { marker: ">"; spaceAfter: boolean };

type InnerRole =
  | "blank"
  | "fence-boundary"
  | "in-fence"
  | "indented-code"
  | "heading-atx"
  | "heading-setext"
  | "hr"
  | "list-item"          // includes task-item via taskState field
  | "table-row"
  | "html-block"
  | "link-ref-def"
  | "prose";

type Classified = {
  prefixes: BlockquoteFrame[];   // outer-to-inner; depth = prefixes.length
  role: InnerRole;
  content: string;               // line content with all prefixes stripped
  rawPrefix: string;             // exact prefix string from input, for round-tripping
  // role-specific extras:
  listMarker?: string;           // e.g. "-", "*", "1.", "1)" — present when role === "list-item"
  hangIndent?: number;           // columns of hang indent for list-item continuations
  taskState?: " " | "x" | "X";   // present when list-item is a task-item
  fenceChar?: "`" | "~";         // present on fence-boundary
  fenceLen?: number;             // present on fence-boundary
  hardBreak?: "spaces" | "backslash"; // present when the line's content ends in a hard break
};
```

The classification procedure for each line:

1. Peel off blockquote frames left-to-right by repeatedly matching `^ {0,3}> ?` and pushing each onto `prefixes`. The remaining substring is the inner content.
2. Run the inner-role recognizers (in the order listed below) against that inner content. The first match wins.
3. Detect a hard break on the inner content (independent of role).

So `> - item` produces `{ prefixes: [{marker: ">", spaceAfter: true}], role: "list-item", listMarker: "-", content: "item", ... }`. A line `> - foo  ` (with two trailing spaces) additionally has `hardBreak: "spaces"`.

> **Note on regex notation.** Regexes below are in fenced code blocks rather than tables, because pipe characters (`|`) in patterns corrupt Markdown table cells. Each regex is the literal source — including the leading `^` anchor — that will be defined as a named `const` in `src/lib/regex.ts`. Regexes apply to the inner content (after blockquote prefix stripping), not the raw line.

**`blank`** — line is empty or whitespace-only.

```
^\s*$
```

**`fence-boundary`** — opens or closes a fenced code block. Toggles classifier state `in-fence`. Closer must match opener char (`` ` `` vs `~`) and have length ≥ opener length.

```
^ {0,3}(`{3,}|~{3,})
```

**`in-fence`** — any line emitted while classifier state `in-fence` is true (other than the matching `fence-boundary` close). Pass-through; never reflowed.

**`indented-code`** — 4+ leading spaces and non-empty body, AND the prior non-blank line is NOT a `list-item` (otherwise this line is a list-item continuation).

```
^ {4,}\S
```

**`heading-atx`** — ATX heading.

```
^ {0,3}#{1,6}(\s|$)
```

**`heading-setext`** — assigned to BOTH the heading text line and its underline. Detection: the next line matches the underline pattern, the current line is non-blank prose, and the current line is not itself a list-item or other special role. (Blockquote prefixes do not block setext detection — `> Title\n> ===` is a valid setext heading inside a quote, with `prefixes` of depth 1 on both lines.) Underline pattern:

```
^ {0,3}(=+|-+)\s*$
```

**`hr`** — horizontal rule. 3+ of the same char, optional internal spaces.

```
^ {0,3}([-*_])(?:\s*\1){2,}\s*$
```

> **Blockquote markers are NOT an inner role** — they are stripped to `prefixes[]` before inner-role classification (see §"Classifier output shape"). The peel pattern is:
>
> ```
> ^ {0,3}> ?
> ```

**`list-item`** — bullet (`-`/`*`/`+`) or ordered (`1.`/`1)`, max 9 digits per CommonMark). Captures indent (group 1), marker (group 2), and the trailing whitespace (group 3) so the hang-indent column is known.

```
^(\s*)([-*+]|\d{1,9}[.)])(\s+)
```

**Task items** — not a separate inner role. A `list-item` whose content begins with `[ ]`, `[x]`, or `[X]` followed by whitespace gets `taskState` set on the `Classified` record; the inner role stays `list-item`. The check pattern (applied to list-item content):

```
^\[[ xX]\]\s
```

**`table-row`** — pipe-delimited table row. Detection requires seeing a separator row, where the separator row pattern (using a regex literal so the pipes don't break the doc) is:

```js
const TABLE_SEPARATOR = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;
```

A line is `table-row` if it (a) matches `TABLE_SEPARATOR`, (b) is the line immediately before one, or (c) is a line containing a pipe that follows the separator row of an active table block (terminated by a blank line).

**`html-block`** — line begins with `<` followed by a known block-level tag name (per CommonMark §4.6 list: `address`, `article`, `aside`, `blockquote`, `details`, `dialog`, `div`, `dl`, `figure`, `figcaption`, `footer`, `form`, `h1`–`h6`, `header`, `hr`, `iframe`, `main`, `nav`, `ol`, `p`, `pre`, `section`, `table`, `ul`, etc.) or with `<!--` (HTML comment) or `<![CDATA[` or `<?` (processing instruction). Pass-through; never reflowed.

**`link-ref-def`** — definition for a reference-style link or footnote.

```
^ {0,3}\[[^\]]+\]:\s+\S
```

**`hard-break`** — a `prose` line ending in two or more trailing spaces, OR a single trailing backslash. Detection regexes:

```
/ {2,}$/      // 2+ trailing spaces (must apply before any trim)
/\\$/         // single trailing backslash
```

**`prose`** — anything else. Reflowed.

Setext detection requires looking at the next line: when classifying line `i`, peek at line `i+1` against the setext underline pattern. The classifier produces `Classified` records (see §"Classifier output shape" — `{ prefixes, role, content, rawPrefix, ...role-specific extras, hardBreak? }`) so the reflower has everything it needs without re-parsing.

### Critical regex notes

These were flagged for careful review:

- **List markers:** `^(\s*)([-*+]|\d{1,9}[.)])(\s+)` — `\d{1,9}` not `\d+` (CommonMark cap), `[.)]` accepts both `1.` and `1)`, capturing the trailing whitespace as group 3 so we know the hang-indent column.
- **Hyphen-join:** `(?:^|[^A-Za-z-])[a-z]+-$` on prior line, `^[a-z]` on next. NOT `\w` — that would match digits. The leading anchor `(?:^|[^A-Za-z-])` ensures the lowercase-letter run before the hyphen isn't preceded by another letter (which would mean a capital-led word) or a hyphen (mid-compound break).
- **Hard break:** `/  +$/` — must be applied before any whitespace trimming.
- **Setext underline:** `^(=+|-+)\s*$` — but only counts as a heading when the prior line is non-blank prose and not itself a special role.
- **HR:** `^(\s{0,3})([-*_])(?:\s*\2){2,}\s*$` — 3+ of the same char, allows internal spaces, captures the char to ensure consistency.
- **Fence:** opener and closer must match char (`` ` `` vs `~`) and the closer's length must be `>=` opener's length.
- **Blockquote peel:** the `^ {0,3}> ?` pattern is applied repeatedly during prefix-stripping (not as a single role match). Reflow grouping requires the entire blockquote prefix stack to match exactly, not just depth.

Each regex will be defined as a named `const` in `src/lib/regex.ts` with a comment showing example matches and counter-examples.

## Platform support

`platforms: ["macOS"]` for v1.

Per the [Store guidelines](https://developers.raycast.com/basics/prepare-an-extension-for-store), the field should match the extension's actual requirements. While `getSelectedText` and `Clipboard.paste` are nominally cross-platform in the Raycast SDK, this extension's UX assumptions (frontmost-app paste, ⌘Z undo behavior, hotkey conventions) are macOS-shaped, and we have no Windows test environment for v1. Adding `"Windows"` is a follow-up after we can verify selection capture, paste targeting, and HUD behavior on Windows.

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

test/                     # automated unit tests (node:test)
  classify.test.ts
  wrap.test.ts
  unwrap.test.ts
  inline.test.ts

test-fixtures/            # markdown files for manual eval (see below)
```

The two entry files should be < 50 lines each. Almost all logic lives in `lib/`.

## Cross-extension contract

Both commands accept `LaunchProps<{ launchContext?: WrapContext | UnwrapContext }>` using only the built-in Raycast SDK types — no `raycast-cross-extension` dependency in v1.

```ts
import { LaunchProps, launchCommand, LaunchType } from "@raycast/api";

type CallbackOptions = {
  name: string;
  type: LaunchType;
  extensionName: string;
  ownerOrAuthorName: string;
};

type WrapContext = {
  text?: string;                            // if absent, fall back to readContent
  width?: number;                           // overrides width preference
  callbackLaunchOptions?: CallbackOptions;  // if present, return result via launchCommand
};

type UnwrapContext = {
  text?: string;
  hyphenation?: boolean;                    // overrides preference
  keepBlankLines?: boolean;                 // overrides preference
  callbackLaunchOptions?: CallbackOptions;
};

// Returning the result to the caller:
if (props.launchContext?.callbackLaunchOptions) {
  await launchCommand({
    ...props.launchContext.callbackLaunchOptions,
    context: { result },
  });
  return;
}
```

This implements the [LitoMore cross-extension convention](https://github.com/LitoMore/raycast-cross-extension-conventions) provider contract using only `@raycast/api` primitives: a consumer extension passes `callbackLaunchOptions` describing where to send the result, and we invoke `launchCommand` with that target plus a `context` payload containing `result`. We're skipping the `raycast-cross-extension` npm package because (a) v1 only ships the provider side, (b) the package's main value is the consumer-side `crossLaunchCommand` helper which we don't need, and (c) keeping the dep tree minimal simplifies Store review. If we add a consumer command later, we can revisit.

When `callbackLaunchOptions` is present, the command always returns via the callback `launchCommand` and does NOT paste, copy, or show a HUD. This is the "always callback when launched cross-extension" simplification agreed during brainstorming.

## README

Top-level `README.md` covers:

- One-paragraph intro: what Wrap / Unwrap is, when to use it.
- Command list with descriptions.
- Preferences reference (rendered as a user-facing table — names, defaults, what each does — derived from the manifest snippets in this spec).
- Suggested hotkeys (e.g. ⌃⌥W for wrap, ⌃⌥U for unwrap — purely a suggestion).
- "For other extensions" — the `WrapContext` / `UnwrapContext` shape and a built-in `launchCommand` example for both invoking the provider and receiving the callback. Notes that this follows the [LitoMore cross-extension convention](https://github.com/LitoMore/raycast-cross-extension-conventions) without taking on the npm package as a dependency.
- Acknowledgement that the source/action pattern follows the Change Case extension's convention.

## Test fixtures

`test-fixtures/` directory with one `.md` file per role plus combination files. Each file has a header block (HTML-comment) describing the input shape and expected behavior.

| file                          | covers                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `01-prose-paragraphs.md`      | basic prose with multiple paragraphs                                                                         |
| `02-headings.md`              | ATX (`#`) and setext (`===`/`---`) headings interleaved with prose                                           |
| `03-bullets-and-lists.md`     | `-`, `*`, `+`, ordered (`1.`, `1)`), task lists `- [ ]`, nested                                              |
| `04-blockquotes.md`           | single-level `>`, nested `> >`, quote-with-list                                                              |
| `05-fenced-code.md`           | ` ``` ` and `~~~` fences with wrapped-looking content (must NOT reflow)                                      |
| `06-indented-code.md`         | 4-space indented code, mixed with prose                                                                      |
| `07-inline-code-and-links.md` | prose with `` `code` ``, `[link](url)`, autolinks                                                            |
| `08-tables.md`                | pipe tables                                                                                                  |
| `09-html-blocks.md`           | `<div>...</div>`, comments                                                                                   |
| `10-link-ref-defs.md`         | reference-style links + footnote definitions                                                                 |
| `11-hyphenation.md`           | soft hyphens (`inter-\nesting` → `interesting`); capital-led preserved; mid-compound limitation             |
| `12-hard-breaks.md`           | trailing-two-spaces, trailing `\`                                                                            |
| `13-mixed-realistic.md`       | a realistic doc combining most of the above                                                                  |
| `14-edge-cases.md`            | empty input, single blank line, whitespace-only line, mixed CRLF, very long single line, no trailing newline |

These are for manual evaluation: paste a fixture into a buffer, run Unwrap (or Wrap), eyeball the result. Expected behaviors are documented inline so the user can judge correctness without reading the algorithm.

## Automated tests

The transforms (`wrap`, `unwrap`, `classify`, `inline`) are pure string-in/string-out functions. They get unit tests using Node's built-in [`node:test`](https://nodejs.org/api/test.html) runner — no test framework dependency. `tsx` is added as a dev dependency to run the TypeScript test files directly.

```jsonc
// package.json scripts
"test": "tsx --test test/*.test.ts"
```

`tsx` is added as a dev dependency. Tests cover:

- **`classify.test.ts`** — every role has at least one positive and one negative case. Critical pairs: `---` as HR vs setext underline (depends on prior line), `*foo*` start-of-line as emphasis vs `* foo` as list item, indented `    code` inside vs outside a list, fence open/close char + length matching, table separator detection, ordered-list 9-digit cap.
- **`wrap.test.ts`** — output never exceeds `width` for joinable regions; preserve-as-is regions emit unchanged; inline code spans and links are never split; oversized tokens emit on their own line; `width < 20` clamps to 20.
- **`unwrap.test.ts`** — paragraphs join with single spaces; blank-line collapse vs preserve; fence/table/HTML pass-through; blockquote depth grouping; list continuation merging; hyphenation rule on (`inter-\nesting` → `interesting`); hyphenation off keeps the hyphen verbatim (`inter-\nesting` → `inter- esting`); capital-led words don't strip (`State-\nwide` → `State- wide`); known limitation — mid-compound breaks gain a space (`state-of-the-\nart` → `state-of-the- art`).
- **`inline.test.ts`** — code spans (`` ` ``, `` `` ``), inline links `[t](u)`, reference links `[t][id]`, autolinks `<https://…>`, `<email@…>` are tokenized and round-trip restore correctly; nested cases (link with code inside the text).

These are intended to catch classifier-ordering regressions and edge-case escapes, NOT to replace the manual fixtures (which test perceived correctness end-to-end via the actual extension).

## Open follow-ups (not part of v1)

- AI tools (`tools/wrap.ts`, `tools/unwrap.ts`) once the core transform is validated against fixtures.
- Per-command argument support (`width` as a Raycast `arguments[]` value for one-off overrides).
- "Sentence per line" wrap mode.
- Localization / CJK width awareness.
