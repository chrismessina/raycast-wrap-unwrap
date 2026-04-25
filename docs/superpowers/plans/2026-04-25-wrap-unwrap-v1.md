# Wrap / Unwrap v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Raycast extension with two `no-view` commands — Wrap Text and Unwrap Text — that transform text from the user's selection or clipboard using a Markdown-aware classifier and reflower, with the source/action preference convention from Change Case.

**Architecture:** Two thin entry-point files (`src/wrap-text.ts`, `src/unwrap-text.ts`) wrap a shared pipeline (`src/lib/pipeline.ts`) that acquires input, guards size, calls a transform, and delivers output. Transforms (`src/lib/wrap.ts`, `src/lib/unwrap.ts`) sit on top of a shared line classifier (`src/lib/classify.ts`) which returns `Classified` records with a blockquote prefix stack plus an inner role. Inline-token protection (`src/lib/inline.ts`) keeps code spans and links atomic during reflow. Pure functions are unit-tested with Node's built-in `node:test` runner via `tsx`; manual `.md` fixtures are kept for end-to-end perception testing in the running extension.

**Tech Stack:** TypeScript (strict, ES2023, CommonJS) · `@raycast/api` · `@raycast/utils` · `node:test` + `tsx` for unit tests · `ray lint --fix` for Prettier formatting before every commit.

**Spec:** [`docs/superpowers/specs/2026-04-25-wrap-unwrap-design.md`](../specs/2026-04-25-wrap-unwrap-design.md)

---

## Conventions for every task in this plan

These apply to every task. Do not skip them.

1. **Run `npx ray lint --fix` before every commit.** Fix any reported issues. This formats code AND markdown.
2. **Never hand-write `Preferences` or `Arguments` types.** Use `getPreferenceValues<Preferences>()` and `LaunchProps<{ arguments: Arguments.CommandName }>` with the auto-generated types Raycast emits to `raycast-env.d.ts`.
3. **No `any` casting.** Use proper types, `unknown` (then narrow), or generics.
4. **Every failure toast must include a "Copy Error" `primaryAction`.** Use the `failureToast` helper introduced in Task 4.
5. **Commit after every passing step.** Frequent commits, small diffs.
6. **TDD where applicable:** for pure functions (classifier, wrap, unwrap, inline), write the failing test first, then the minimal implementation. For Raycast SDK glue (entry points, pipeline delivery), the manual fixture set is the test plan; a unit test of the pipeline against a mocked SDK is overkill.
7. **Files this plan never modifies:** `raycast-env.d.ts` (auto-generated; git-ignored).

---

## File layout produced by this plan

```
src/
  wrap-text.ts            # entry point — acquire → guard → wrap → deliver
  unwrap-text.ts          # entry point — acquire → guard → unwrap → deliver
  lib/
    pipeline.ts           # readContent, NoTextError, deliver, MAX_INPUT, failureToast
    regex.ts              # named regex constants used by classifier
    classify.ts           # classify(text) → Classified[]
    inline.ts             # protect/restore inline tokens (code spans, links, autolinks)
    wrap.ts               # wrap(text, { width })
    unwrap.ts             # unwrap(text, { hyphenation, keepBlankLines })

test/
  classify.test.ts
  inline.test.ts
  wrap.test.ts
  unwrap.test.ts

test-fixtures/            # 14 .md files for manual E2E eval (Task 14)

README.md                 # extension README (Task 15)
CHANGELOG.md              # Store changelog with {PR_MERGE_DATE} (Task 15)
package.json              # manifest — preferences, platforms, commands (Task 1)
tsconfig.json             # already correct; do not modify
```

---

## Task 1: Manifest and tooling setup

**Files:**

- Modify: `package.json`
- Create: `eslint.config.mjs` (replaces existing `eslint.config.js`)
- Delete: `eslint.config.js`

This task wires up the manifest (preferences, platforms, command titles), adds `tsx` for tests, migrates ESLint to a `.mjs` flat config, and updates command descriptions.

- [ ] **Step 1: Replace `package.json` with the v1 manifest**

Write the file exactly as below. Note: the existing file declares `Windows` in `platforms` and a typo "Wrap text at a index." — both are corrected.

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "wrap-unwrap",
  "title": "Wrap Unwrap",
  "description": "Wrap and unwrap text using Markdown-aware reflow.",
  "license": "MIT",
  "author": "chrismessina",
  "icon": "extension-icon.png",
  "platforms": ["macOS"],
  "categories": ["Productivity"],
  "scripts": {
    "dev": "ray develop",
    "lint": "ray lint",
    "fix-lint": "ray lint --fix",
    "build": "ray build",
    "test": "tsx --test test/*.test.ts",
    "publish": "npx @raycast/api@latest publish",
    "prepublishOnly": "echo \"\\n\\nIt seems like you are trying to publish the Raycast extension to npm.\\n\\nIf you did intend to publish it to npm, remove the \\`prepublishOnly\\` script and rerun \\`npm publish\\` again.\\nIf you wanted to publish it to the Raycast Store instead, use \\`npm run publish\\` instead.\\n\\n\" && exit 1"
  },
  "dependencies": {
    "@raycast/api": "^1.103.0",
    "@raycast/utils": "^2.2.1"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^2.0.4",
    "@types/node": "22.19.17",
    "@types/react": "19.0.10",
    "eslint": "^9.22.0",
    "prettier": "^3.5.3",
    "tsx": "^4.20.0",
    "typescript": "^5.8.2"
  },
  "preferences": [
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
  ],
  "commands": [
    {
      "name": "wrap-text",
      "title": "Wrap Text",
      "subtitle": "Wrap Unwrap",
      "description": "Wrap text at a configurable column width.",
      "mode": "no-view",
      "preferences": [
        {
          "name": "width",
          "title": "Wrap Column",
          "description": "Wrap lines at this column. Must be a positive integer; falls back to 80 on invalid input.",
          "type": "textfield",
          "required": false,
          "default": "80",
          "placeholder": "80"
        }
      ]
    },
    {
      "name": "unwrap-text",
      "title": "Unwrap Text",
      "subtitle": "Wrap Unwrap",
      "description": "Reflow wrapped text into continuous paragraphs while preserving Markdown structure.",
      "mode": "no-view",
      "preferences": [
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
    }
  ]
}
```

- [ ] **Step 2: Migrate ESLint config to flat `.mjs`**

Delete `eslint.config.js`. Create `eslint.config.mjs`:

```js
import { defineConfig } from "eslint/config";
import raycastConfig from "@raycast/eslint-config";

export default defineConfig([...raycastConfig]);
```

Run:

```bash
rm eslint.config.js
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: installs `tsx`, regenerates `package-lock.json`, no audit errors blocking install.

- [ ] **Step 4: Verify build works**

Run: `npm run build`
Expected: succeeds. `raycast-env.d.ts` is regenerated with the new `Preferences` shape (you can `cat raycast-env.d.ts` to confirm `interface Preferences { source: ...; action: ...; hideHUD: boolean; popToRoot: boolean; }` is present).

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add package.json package-lock.json eslint.config.mjs
git rm eslint.config.js
git commit -m "chore: migrate manifest to v1 design (prefs, platforms, descriptions)"
```

---

## Task 2: Test runner skeleton + smoke test

**Files:**

- Create: `test/smoke.test.ts`

Verify the test runner works before writing real tests.

- [ ] **Step 1: Create the smoke test**

```ts
// test/smoke.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("test runner is wired up", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run it**

Run: `npm test`
Expected: `# pass 1` (or equivalent green output from `node:test`).

- [ ] **Step 3: Commit**

```bash
npx ray lint --fix
git add test/smoke.test.ts
git commit -m "test: add smoke test confirming node:test + tsx runner"
```

---

## Task 3: Regex constants

**Files:**

- Create: `src/lib/regex.ts`
- Create: `test/regex.test.ts`

Named regex constants live in their own module so the classifier reads cleanly and so the patterns can be tested in isolation.

- [ ] **Step 1: Write the failing test**

```ts
// test/regex.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKQUOTE_PEEL,
  FENCE_BOUNDARY,
  INDENTED_CODE,
  HEADING_ATX,
  SETEXT_UNDERLINE,
  HR,
  LIST_ITEM,
  TASK_MARKER,
  LINK_REF_DEF,
  TABLE_SEPARATOR,
  HARD_BREAK_SPACES,
  HARD_BREAK_BACKSLASH,
  HYPHEN_BREAK_END,
} from "../src/lib/regex.js";

test("BLOCKQUOTE_PEEL matches a single quote frame", () => {
  assert.match("> hello", BLOCKQUOTE_PEEL);
  assert.match(">hello", BLOCKQUOTE_PEEL);
  assert.doesNotMatch("hello", BLOCKQUOTE_PEEL);
});

test("FENCE_BOUNDARY matches both backtick and tilde fences", () => {
  assert.match("```", FENCE_BOUNDARY);
  assert.match("~~~~", FENCE_BOUNDARY);
  assert.match("   ```js", FENCE_BOUNDARY);
  assert.doesNotMatch("``", FENCE_BOUNDARY);
  assert.doesNotMatch("    ```", FENCE_BOUNDARY); // 4 spaces = code block, not fence
});

test("HEADING_ATX matches ATX headings 1-6", () => {
  assert.match("# H1", HEADING_ATX);
  assert.match("###### H6", HEADING_ATX);
  assert.match("#", HEADING_ATX);
  assert.doesNotMatch("####### too many", HEADING_ATX);
  assert.doesNotMatch("#nospace", HEADING_ATX);
});

test("SETEXT_UNDERLINE matches = and - rules", () => {
  assert.match("===", SETEXT_UNDERLINE);
  assert.match("---", SETEXT_UNDERLINE);
  assert.match("=", SETEXT_UNDERLINE);
  assert.doesNotMatch("=-=", SETEXT_UNDERLINE);
  assert.doesNotMatch("", SETEXT_UNDERLINE);
});

test("HR matches 3+ same chars; rejects mixed", () => {
  assert.match("---", HR);
  assert.match("***", HR);
  assert.match("___", HR);
  assert.match("- - -", HR);
  assert.doesNotMatch("--", HR);
  assert.doesNotMatch("-*-", HR);
});

test("LIST_ITEM captures indent, marker, and gap", () => {
  const m = "  - item".match(LIST_ITEM);
  assert.ok(m);
  assert.equal(m[1], "  ");
  assert.equal(m[2], "-");
  assert.equal(m[3], " ");

  const ord = "1. item".match(LIST_ITEM);
  assert.ok(ord);
  assert.equal(ord[2], "1.");

  const paren = "10) item".match(LIST_ITEM);
  assert.ok(paren);
  assert.equal(paren[2], "10)");

  // 9-digit cap
  assert.doesNotMatch("1234567890. item", LIST_ITEM);
  assert.doesNotMatch("*nospace", LIST_ITEM);
});

test("TASK_MARKER matches checkbox prefix", () => {
  assert.match("[ ] todo", TASK_MARKER);
  assert.match("[x] done", TASK_MARKER);
  assert.match("[X] done", TASK_MARKER);
  assert.doesNotMatch("[y] bad", TASK_MARKER);
});

test("LINK_REF_DEF matches reference link definitions", () => {
  assert.match("[id]: https://example.com", LINK_REF_DEF);
  assert.match('[id]: https://example.com "title"', LINK_REF_DEF);
  assert.doesNotMatch("[id]:", LINK_REF_DEF);
});

test("TABLE_SEPARATOR matches separator rows", () => {
  assert.match("| --- | --- |", TABLE_SEPARATOR);
  assert.match("|:--|:-:|--:|", TABLE_SEPARATOR);
  assert.match("--- | ---", TABLE_SEPARATOR);
  assert.doesNotMatch("| header | header |", TABLE_SEPARATOR);
});

test("HARD_BREAK_SPACES matches 2+ trailing spaces", () => {
  assert.match("foo  ", HARD_BREAK_SPACES);
  assert.match("foo    ", HARD_BREAK_SPACES);
  assert.doesNotMatch("foo ", HARD_BREAK_SPACES);
  assert.doesNotMatch("foo", HARD_BREAK_SPACES);
});

test("HARD_BREAK_BACKSLASH matches single trailing backslash", () => {
  assert.match("foo\\", HARD_BREAK_BACKSLASH);
  assert.doesNotMatch("foo", HARD_BREAK_BACKSLASH);
});

test("HYPHEN_BREAK_END matches lowercase letter + hyphen at end", () => {
  assert.match("inter-", HYPHEN_BREAK_END);
  assert.doesNotMatch("State-", HYPHEN_BREAK_END); // capital before hyphen
  assert.doesNotMatch("123-", HYPHEN_BREAK_END);
  assert.doesNotMatch("inter", HYPHEN_BREAK_END);
});

test("INDENTED_CODE matches 4+ leading spaces", () => {
  assert.match("    code", INDENTED_CODE);
  assert.match("        deeper", INDENTED_CODE);
  assert.doesNotMatch("   not code", INDENTED_CODE); // only 3 spaces
  assert.doesNotMatch("    ", INDENTED_CODE); // no body
});
```

- [ ] **Step 2: Run the test — it should fail because `regex.ts` doesn't exist**

Run: `npm test`
Expected: errors like `Cannot find module '../src/lib/regex.js'`.

- [ ] **Step 3: Implement `src/lib/regex.ts`**

```ts
// src/lib/regex.ts

/** Single blockquote frame at line start: optional 0-3 spaces, `>`, optional single space. */
export const BLOCKQUOTE_PEEL = /^ {0,3}> ?/;

/** Fenced code-block opener/closer: backtick or tilde, length ≥ 3. */
export const FENCE_BOUNDARY = /^ {0,3}(`{3,}|~{3,})/;

/** Indented code: 4+ leading spaces with a non-space body. */
export const INDENTED_CODE = /^ {4,}\S/;

/** ATX heading: 1-6 `#` followed by whitespace or EOL. */
export const HEADING_ATX = /^ {0,3}#{1,6}(\s|$)/;

/** Setext underline (= for h1, - for h2). Caller must verify the prior line is non-empty prose. */
export const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)\s*$/;

/** Horizontal rule: 3+ of the same char (- * _), optional internal spaces. */
export const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

/**
 * List-item start. Captures:
 *   group 1: leading indent
 *   group 2: marker (`-` `*` `+` or `\d{1,9}[.)]` per CommonMark 9-digit cap)
 *   group 3: trailing whitespace (defines hang indent column)
 */
export const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/;

/** Task-item marker, applied to list-item content (after stripping the list marker). */
export const TASK_MARKER = /^\[[ xX]\]\s/;

/** Reference-style link or footnote definition. */
export const LINK_REF_DEF = /^ {0,3}\[[^\]]+\]:\s+\S/;

/**
 * Pipe-table separator row. Used to confirm an adjacent pipe-bearing line is a table row.
 * Examples that match: `| --- |`, `|:--|--:|`, `--- | ---`.
 */
export const TABLE_SEPARATOR = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

/** Hard break: 2+ trailing spaces. Apply BEFORE any trim. */
export const HARD_BREAK_SPACES = / {2,}$/;

/** Hard break: single trailing backslash. */
export const HARD_BREAK_BACKSLASH = /\\$/;

/**
 * Soft hyphen at end of a prose line — lowercase letter immediately before
 * the trailing hyphen. NOT \w, because we don't want digits.
 */
export const HYPHEN_BREAK_END = /[a-z]-$/;
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all `regex.test.ts` cases pass; smoke test still passes.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/regex.ts test/regex.test.ts
git commit -m "feat: add named regex constants for line classifier"
```

---

## Task 4: Pipeline scaffolding (input/output/error)

**Files:**

- Create: `src/lib/pipeline.ts`

This module owns: input acquisition, the size guard, the output delivery routing, and the `failureToast` helper. It does not depend on the classifier — it's pure SDK glue plus a couple of helpers.

The pipeline cannot be unit-tested without mocking `@raycast/api`; we leave it untested and rely on Task 14's manual fixtures + the build step (`npm run build`) to catch type errors. The transforms below ARE unit-tested.

- [ ] **Step 1: Write `src/lib/pipeline.ts`**

```ts
// src/lib/pipeline.ts
import { Clipboard, Toast, getSelectedText, launchCommand, popToRoot, showHUD, showToast } from "@raycast/api";
import type { LaunchProps, LaunchType } from "@raycast/api";

export const MAX_INPUT = 1_000_000;

export class NoTextError extends Error {
  constructor() {
    super("No text");
    Object.setPrototypeOf(this, NoTextError.prototype);
  }
}

export class OversizeError extends Error {
  constructor(public readonly length: number) {
    super(`Input is ${length} characters; exceeds ${MAX_INPUT}`);
    Object.setPrototypeOf(this, OversizeError.prototype);
  }
}

/** Cross-extension callback descriptor — the LitoMore convention, expressed in built-in SDK types. */
export type CallbackOptions = {
  name: string;
  type: LaunchType;
  extensionName: string;
  ownerOrAuthorName: string;
};

/** Shared shape; callers narrow the role-specific options separately. */
export type BaseLaunchContext = {
  text?: string;
  callbackLaunchOptions?: CallbackOptions;
};

async function getSelection(): Promise<string> {
  try {
    return await getSelectedText();
  } catch {
    return "";
  }
}

/**
 * Read input from the user's preferred source, falling back to the other.
 * Throws `NoTextError` if neither has text.
 */
export async function readContent(preferredSource: "selection" | "clipboard"): Promise<string> {
  const clipboard = (await Clipboard.readText()) ?? "";
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

/** Throws OversizeError when input exceeds MAX_INPUT. */
export function guardSize(input: string): void {
  if (input.length > MAX_INPUT) throw new OversizeError(input.length);
}

/** Toast for any failure path. ALWAYS includes Copy Error primaryAction. */
export async function failureToast(title: string, message: string): Promise<void> {
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

export type DeliveryPrefs = {
  action: "paste" | "copy";
  hideHUD: boolean;
  popToRoot: boolean;
};

export type DeliveryContext<C extends BaseLaunchContext> = {
  /** What was launched-context — if `callbackLaunchOptions` is set, we route the callback. */
  launchContext: C | undefined;
  prefs: DeliveryPrefs;
  result: string;
  /** Used in HUD copy: "Pasted wrapped text" / "Copied unwrapped text" / etc. */
  noun: "wrapped" | "unwrapped";
};

/** Deliver result. Cross-extension callback short-circuits paste/copy/HUD. */
export async function deliver<C extends BaseLaunchContext>({
  launchContext,
  prefs,
  result,
  noun,
}: DeliveryContext<C>): Promise<void> {
  if (launchContext?.callbackLaunchOptions) {
    await launchCommand({
      ...launchContext.callbackLaunchOptions,
      context: { result },
    });
    return;
  }
  if (prefs.action === "paste") {
    await Clipboard.paste(result);
  } else {
    await Clipboard.copy(result);
  }
  if (!prefs.hideHUD) {
    const verb = prefs.action === "paste" ? "Pasted" : "Copied";
    await showHUD(`${verb} ${noun} text`);
  }
  if (prefs.popToRoot) {
    await popToRoot();
  }
}

/**
 * Convert the user's `width` preference (a `textfield` returning string) into a
 * positive integer, falling back to 80 on NaN/non-positive input.
 */
export function parseWidth(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 80;
}

/** Re-exported so entry points don't import @raycast/api just for LaunchProps. */
export type { LaunchProps };
```

- [ ] **Step 2: Run typecheck via build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
npx ray lint --fix
git add src/lib/pipeline.ts
git commit -m "feat: add pipeline scaffolding (read/guard/deliver/failureToast)"
```

---

## Task 5: Inline-token tokenize/restore

**Files:**

- Create: `src/lib/inline.ts`
- Create: `test/inline.test.ts`

Protect inline code spans, inline links, reference links, and autolinks during reflow so the joiner never inserts a space inside them. Strategy: replace each match with a single placeholder (` <index>`), do the reflow, then substitute back.

- [ ] **Step 1: Write the failing test**

```ts
// test/inline.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { protectInline, restoreInline } from "../src/lib/inline.js";

test("protectInline replaces inline code spans with placeholders", () => {
  const { protected: p, tokens } = protectInline("foo `bar baz` qux");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0], "`bar baz`");
  // placeholder format must contain no spaces, so reflow won't split it
  assert.ok(!p.includes(" bar baz "));
  assert.equal(restoreInline(p, tokens), "foo `bar baz` qux");
});

test("protectInline handles double-backtick spans", () => {
  const { protected: p, tokens } = protectInline("see ``a `b` c`` here");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0], "``a `b` c``");
  assert.equal(restoreInline(p, tokens), "see ``a `b` c`` here");
});

test("protectInline replaces inline links", () => {
  const { protected: p, tokens } = protectInline("see [the docs](https://example.com/a b) now");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0], "[the docs](https://example.com/a b)");
  assert.equal(restoreInline(p, tokens), "see [the docs](https://example.com/a b) now");
});

test("protectInline replaces reference links", () => {
  const { protected: p, tokens } = protectInline("see [the docs][docs-id] now");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0], "[the docs][docs-id]");
  assert.equal(restoreInline(p, tokens), "see [the docs][docs-id] now");
});

test("protectInline replaces autolinks", () => {
  const { protected: p, tokens } = protectInline("ping <https://example.com> please");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0], "<https://example.com>");
  assert.equal(restoreInline(p, tokens), "ping <https://example.com> please");
});

test("protectInline handles multiple tokens in one string", () => {
  const input = "use `foo` and [bar](https://x.test) and <https://y.test>";
  const { protected: p, tokens } = protectInline(input);
  assert.equal(tokens.length, 3);
  assert.equal(restoreInline(p, tokens), input);
});

test("protected output contains no spaces from token bodies", () => {
  // This is the load-bearing property: a wrapper joining on whitespace
  // must never see a space that came from inside a token.
  const { protected: p } = protectInline("`a b c` and `d e f`");
  // Whatever the placeholder shape, the protected string should not contain
  // "a b c" or "d e f" verbatim.
  assert.ok(!p.includes("a b c"));
  assert.ok(!p.includes("d e f"));
});

test("restoreInline is a no-op when no tokens", () => {
  assert.equal(restoreInline("plain text", []), "plain text");
});
```

- [ ] **Step 2: Run the test — it should fail**

Run: `npm test`
Expected: `Cannot find module '../src/lib/inline.js'`.

- [ ] **Step 3: Implement `src/lib/inline.ts`**

```ts
// src/lib/inline.ts

/**
 * Match inline tokens that must never be split during reflow.
 * Order matters: longer/more-specific patterns first.
 *
 *   1. Double-backtick code spans (``...``) — must come before single-backtick.
 *   2. Single-backtick code spans (`...`).
 *   3. Inline links: [text](url) — url may contain spaces, so we lazy-match through `)`.
 *   4. Reference links: [text][id].
 *   5. Autolinks: <https://...>, <mailto:...>, <user@host>.
 */
const INLINE_PATTERNS = [
  /``[^`]*?``/g,
  /`[^`\n]+?`/g,
  /\[[^\]]*?\]\([^)]*?\)/g,
  /\[[^\]]*?\]\[[^\]]*?\]/g,
  /<(?:https?:\/\/|mailto:)[^>\s]+>/g,
  /<[^\s@<>]+@[^\s@<>]+>/g,
];

const PLACEHOLDER_OPEN = " ";
const PLACEHOLDER_CLOSE = "";

export type Protected = {
  protected: string;
  tokens: string[];
};

export function protectInline(input: string): Protected {
  const tokens: string[] = [];
  let working = input;
  for (const pattern of INLINE_PATTERNS) {
    working = working.replace(pattern, (match) => {
      const idx = tokens.length;
      tokens.push(match);
      return `${PLACEHOLDER_OPEN}${idx}${PLACEHOLDER_CLOSE}`;
    });
  }
  return { protected: working, tokens };
}

export function restoreInline(input: string, tokens: string[]): string {
  if (tokens.length === 0) return input;
  return input.replace(/ (\d+)/g, (_, idxStr) => {
    const idx = Number.parseInt(idxStr, 10);
    return tokens[idx] ?? "";
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all `inline.test.ts` cases pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/inline.ts test/inline.test.ts
git commit -m "feat: add inline-token protection for reflow"
```

---

## Task 6: Classifier — output types and signature

**Files:**

- Create: `src/lib/classify.ts` (types + stub only)
- Create: `test/classify.test.ts` (single failing test)

This task introduces the `Classified` type, the `classify` signature, and one failing test. The next several tasks fill in the recognizers role-by-role.

- [ ] **Step 1: Write the failing test**

```ts
// test/classify.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/lib/classify.js";

test("classify emits one record per input line", () => {
  const result = classify("a\nb\nc");
  assert.equal(result.length, 3);
  assert.equal(result[0].content, "a");
  assert.equal(result[1].content, "b");
  assert.equal(result[2].content, "c");
});
```

- [ ] **Step 2: Run the test — it should fail**

Run: `npm test`
Expected: module not found.

- [ ] **Step 3: Write `src/lib/classify.ts` with types and a stub**

```ts
// src/lib/classify.ts

export type BlockquoteFrame = { marker: ">"; spaceAfter: boolean };

export type InnerRole =
  | "blank"
  | "fence-boundary"
  | "in-fence"
  | "indented-code"
  | "heading-atx"
  | "heading-setext"
  | "hr"
  | "list-item"
  | "table-row"
  | "html-block"
  | "link-ref-def"
  | "prose";

export type Classified = {
  /** Outer-to-inner blockquote frames. Depth = prefixes.length. */
  prefixes: BlockquoteFrame[];
  role: InnerRole;
  /** Line content with all prefixes stripped. */
  content: string;
  /** Exact prefix string as it appeared in the input — used for round-trip emission. */
  rawPrefix: string;
  // role-specific extras:
  listMarker?: string;
  hangIndent?: number;
  taskState?: " " | "x" | "X";
  fenceChar?: "`" | "~";
  fenceLen?: number;
  hardBreak?: "spaces" | "backslash";
};

export function classify(text: string): Classified[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => ({
    prefixes: [],
    role: "prose" as InnerRole,
    content: line,
    rawPrefix: "",
  }));
}
```

- [ ] **Step 4: Run the test**

Run: `npm test`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat: scaffold classifier types and stub"
```

---

## Task 7: Classifier — blockquote prefix peeling and blank lines

**Files:**

- Modify: `src/lib/classify.ts`
- Modify: `test/classify.test.ts`

Add blockquote prefix peeling and blank-line classification. After this task, `> > foo` produces a depth-2 prefix stack with inner content `foo`.

- [ ] **Step 1: Add failing tests**

Append to `test/classify.test.ts`:

```ts
test("classify recognizes blank lines", () => {
  const r = classify("\n   \n\t\n");
  assert.equal(r.length, 4);
  assert.equal(r[0].role, "blank");
  assert.equal(r[1].role, "blank");
  assert.equal(r[2].role, "blank");
});

test("classify peels a single blockquote frame", () => {
  const r = classify("> hello");
  assert.equal(r.length, 1);
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[0].prefixes[0].marker, ">");
  assert.equal(r[0].prefixes[0].spaceAfter, true);
  assert.equal(r[0].content, "hello");
  assert.equal(r[0].rawPrefix, "> ");
});

test("classify peels nested blockquote frames", () => {
  const r = classify("> > nested");
  assert.equal(r[0].prefixes.length, 2);
  assert.equal(r[0].content, "nested");
  assert.equal(r[0].rawPrefix, "> > ");
});

test("classify peels blockquote with no space after marker", () => {
  const r = classify(">foo");
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[0].prefixes[0].spaceAfter, false);
  assert.equal(r[0].content, "foo");
});

test("classify treats blockquote-only line as blank inside the quote", () => {
  // CommonMark: `>` alone is a blockquote containing a blank line.
  const r = classify(">");
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[0].role, "blank");
});

test("CRLF line endings are normalized", () => {
  const r = classify("a\r\nb\rc");
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((x) => x.content),
    ["a", "b", "c"],
  );
});
```

- [ ] **Step 2: Run tests — new ones should fail**

Run: `npm test`
Expected: the new cases fail; the previous one still passes.

- [ ] **Step 3: Implement peeling**

Replace `classify` in `src/lib/classify.ts`:

```ts
import { BLOCKQUOTE_PEEL } from "./regex.js";

// (keep the existing types above)

function peelBlockquotes(line: string): { prefixes: BlockquoteFrame[]; content: string; rawPrefix: string } {
  const prefixes: BlockquoteFrame[] = [];
  let rest = line;
  let rawPrefix = "";
  while (true) {
    const match = rest.match(BLOCKQUOTE_PEEL);
    if (!match) break;
    const matchedText = match[0];
    const spaceAfter = matchedText.endsWith(" ");
    prefixes.push({ marker: ">", spaceAfter });
    rawPrefix += matchedText;
    rest = rest.slice(matchedText.length);
  }
  return { prefixes, content: rest, rawPrefix };
}

function isBlank(content: string): boolean {
  return /^\s*$/.test(content);
}

export function classify(text: string): Classified[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line): Classified => {
    const { prefixes, content, rawPrefix } = peelBlockquotes(line);
    if (isBlank(content)) {
      return { prefixes, role: "blank", content, rawPrefix };
    }
    return { prefixes, role: "prose", content, rawPrefix };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all classify tests pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat(classify): peel blockquote frames + recognize blank lines"
```

---

## Task 8: Classifier — fences (with stateful in-fence tracking)

**Files:**

- Modify: `src/lib/classify.ts`
- Modify: `test/classify.test.ts`

Fences are stateful: once a `` ``` `` opens, every subsequent line is `in-fence` until a matching closer (same char, length ≥ opener). Lines inside a fence skip all other classification.

- [ ] **Step 1: Add failing tests**

```ts
test("classify recognizes fence boundary and in-fence lines", () => {
  const r = classify("```js\ncode here\nmore code\n```\nafter");
  assert.equal(r[0].role, "fence-boundary");
  assert.equal(r[0].fenceChar, "`");
  assert.equal(r[0].fenceLen, 3);
  assert.equal(r[1].role, "in-fence");
  assert.equal(r[2].role, "in-fence");
  assert.equal(r[3].role, "fence-boundary");
  assert.equal(r[4].role, "prose");
});

test("classify requires closer to match opener char", () => {
  // ~~~ does not close ```
  const r = classify("```\nstuff\n~~~\n```");
  assert.equal(r[0].role, "fence-boundary");
  assert.equal(r[1].role, "in-fence");
  assert.equal(r[2].role, "in-fence"); // not a closer for ```
  assert.equal(r[3].role, "fence-boundary");
});

test("classify accepts longer closer than opener", () => {
  const r = classify("```\nstuff\n`````\nafter");
  assert.equal(r[2].role, "fence-boundary");
  assert.equal(r[3].role, "prose");
});

test("classify rejects shorter closer than opener", () => {
  const r = classify("`````\nstuff\n```\nstill in fence");
  assert.equal(r[2].role, "in-fence");
});

test("classify allows fences inside blockquotes", () => {
  const r = classify("> ```\n> code\n> ```");
  assert.equal(r[0].role, "fence-boundary");
  assert.equal(r[0].prefixes.length, 1);
  assert.equal(r[1].role, "in-fence");
  assert.equal(r[2].role, "fence-boundary");
});
```

- [ ] **Step 2: Run tests — new ones fail**

Run: `npm test`

- [ ] **Step 3: Add fence state machine**

Update `classify` in `src/lib/classify.ts`:

```ts
import { BLOCKQUOTE_PEEL, FENCE_BOUNDARY } from "./regex.js";

// ...peelBlockquotes and isBlank stay as-is...

type FenceState = { char: "`" | "~"; len: number } | null;

function classifyFenceBoundary(content: string): { fenceChar: "`" | "~"; fenceLen: number } | null {
  const m = content.match(FENCE_BOUNDARY);
  if (!m) return null;
  const run = m[1];
  return { fenceChar: run[0] as "`" | "~", fenceLen: run.length };
}

export function classify(text: string): Classified[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Classified[] = [];
  let fence: FenceState = null;

  for (const line of lines) {
    const { prefixes, content, rawPrefix } = peelBlockquotes(line);

    // Inside a fence: only allow a matching closer; everything else is in-fence (but a blank line still counts as in-fence).
    if (fence) {
      const fb = classifyFenceBoundary(content);
      if (fb && fb.fenceChar === fence.char && fb.fenceLen >= fence.len) {
        out.push({ prefixes, role: "fence-boundary", content, rawPrefix, fenceChar: fb.fenceChar, fenceLen: fb.fenceLen });
        fence = null;
      } else {
        out.push({ prefixes, role: "in-fence", content, rawPrefix });
      }
      continue;
    }

    // Outside a fence:
    if (isBlank(content)) {
      out.push({ prefixes, role: "blank", content, rawPrefix });
      continue;
    }

    const fb = classifyFenceBoundary(content);
    if (fb) {
      fence = { char: fb.fenceChar, len: fb.fenceLen };
      out.push({ prefixes, role: "fence-boundary", content, rawPrefix, fenceChar: fb.fenceChar, fenceLen: fb.fenceLen });
      continue;
    }

    out.push({ prefixes, role: "prose", content, rawPrefix });
  }

  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat(classify): track fenced code blocks with stateful in-fence flag"
```

---

## Task 9: Classifier — remaining inner roles

**Files:**

- Modify: `src/lib/classify.ts`
- Modify: `test/classify.test.ts`

Add the remaining recognizers (in this order, since classification stops at first match): `heading-atx`, `hr`, `link-ref-def`, `list-item` (with task detection and hang-indent calculation), `indented-code` (with list-continuation suppression), `html-block`, `heading-setext` (needs lookahead — handled in Task 10), `table-row` (needs lookahead/lookbehind — handled in Task 11). Hard-break detection is added in Task 12.

- [ ] **Step 1: Add failing tests for the roles in this task**

```ts
test("classify recognizes ATX headings", () => {
  const r = classify("# H1\n## H2\n###### H6");
  assert.equal(r[0].role, "heading-atx");
  assert.equal(r[1].role, "heading-atx");
  assert.equal(r[2].role, "heading-atx");
});

test("classify recognizes horizontal rules", () => {
  const r = classify("---\n***\n___\n- - -");
  assert.equal(r[0].role, "hr");
  assert.equal(r[1].role, "hr");
  assert.equal(r[2].role, "hr");
  assert.equal(r[3].role, "hr");
});

test("classify recognizes link reference definitions", () => {
  const r = classify('[id]: https://example.com "title"');
  assert.equal(r[0].role, "link-ref-def");
});

test("classify recognizes list items and captures marker + hang indent", () => {
  const r = classify("- item\n  * nested\n10) ten");
  assert.equal(r[0].role, "list-item");
  assert.equal(r[0].listMarker, "-");
  assert.equal(r[0].hangIndent, 2);
  assert.equal(r[0].content, "item");

  assert.equal(r[1].role, "list-item");
  assert.equal(r[1].listMarker, "*");
  assert.equal(r[1].hangIndent, 4); // 2-space indent + "* " = 4

  assert.equal(r[2].role, "list-item");
  assert.equal(r[2].listMarker, "10)");
  assert.equal(r[2].hangIndent, 4); // "10) " = 4
});

test("classify detects task items via taskState", () => {
  const r = classify("- [ ] todo\n- [x] done\n- [X] done");
  assert.equal(r[0].role, "list-item");
  assert.equal(r[0].taskState, " ");
  assert.equal(r[0].content, "todo");
  assert.equal(r[1].taskState, "x");
  assert.equal(r[2].taskState, "X");
});

test("classify recognizes indented code outside a list", () => {
  const r = classify("para\n\n    code\n    more code");
  assert.equal(r[0].role, "prose");
  assert.equal(r[1].role, "blank");
  assert.equal(r[2].role, "indented-code");
  assert.equal(r[3].role, "indented-code");
});

test("classify treats indented text after a list item as list continuation, not code", () => {
  // 4-space indentation under a list-item marker is continuation, not a code block.
  const r = classify("- item\n    continuation");
  assert.equal(r[0].role, "list-item");
  assert.equal(r[1].role, "prose"); // not indented-code
});

test("classify recognizes HTML blocks", () => {
  const r = classify("<div>\nhello\n</div>");
  assert.equal(r[0].role, "html-block");
  // Subsequent lines inside an HTML block aren't tracked specially in v1 — they're prose.
  // This is acceptable per spec.
});

test("classify recognizes HTML comments as html-block", () => {
  const r = classify("<!-- comment -->");
  assert.equal(r[0].role, "html-block");
});
```

- [ ] **Step 2: Run tests — new ones fail**

Run: `npm test`

- [ ] **Step 3: Implement remaining recognizers**

Update `src/lib/classify.ts`. Add helper functions and extend the main loop. Insert these helpers ABOVE the `classify` function:

```ts
import {
  BLOCKQUOTE_PEEL,
  FENCE_BOUNDARY,
  HEADING_ATX,
  HR,
  INDENTED_CODE,
  LINK_REF_DEF,
  LIST_ITEM,
  TASK_MARKER,
} from "./regex.js";

// Block-level HTML tags from CommonMark §4.6 (not exhaustive — common ones).
const HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog",
  "div", "dl", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "iframe",
  "main", "nav", "ol", "p", "pre", "section", "table", "ul",
]);

function classifyHtmlBlockStart(content: string): boolean {
  if (content.startsWith("<!--")) return true;
  if (content.startsWith("<![CDATA[")) return true;
  if (content.startsWith("<?")) return true;
  const m = content.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!m) return false;
  return HTML_BLOCK_TAGS.has(m[1].toLowerCase());
}

function classifyListItem(content: string): { listMarker: string; hangIndent: number; taskState?: " " | "x" | "X"; innerContent: string } | null {
  const m = content.match(LIST_ITEM);
  if (!m) return null;
  const indent = m[1];
  const marker = m[2];
  const gap = m[3];
  const hangIndent = indent.length + marker.length + gap.length;
  const afterMarker = content.slice(hangIndent);
  const taskMatch = afterMarker.match(TASK_MARKER);
  if (taskMatch) {
    return {
      listMarker: marker,
      hangIndent,
      taskState: taskMatch[0][1] as " " | "x" | "X",
      innerContent: afterMarker.slice(taskMatch[0].length),
    };
  }
  return { listMarker: marker, hangIndent, innerContent: afterMarker };
}
```

Now extend the `classify` main loop. Replace the body (after the fence-handling block) with:

```ts
    // Outside a fence:
    if (isBlank(content)) {
      out.push({ prefixes, role: "blank", content, rawPrefix });
      continue;
    }

    const fb = classifyFenceBoundary(content);
    if (fb) {
      fence = { char: fb.fenceChar, len: fb.fenceLen };
      out.push({ prefixes, role: "fence-boundary", content, rawPrefix, fenceChar: fb.fenceChar, fenceLen: fb.fenceLen });
      continue;
    }

    if (HEADING_ATX.test(content)) {
      out.push({ prefixes, role: "heading-atx", content, rawPrefix });
      continue;
    }

    if (HR.test(content)) {
      out.push({ prefixes, role: "hr", content, rawPrefix });
      continue;
    }

    if (LINK_REF_DEF.test(content)) {
      out.push({ prefixes, role: "link-ref-def", content, rawPrefix });
      continue;
    }

    const li = classifyListItem(content);
    if (li) {
      out.push({
        prefixes,
        role: "list-item",
        content: li.innerContent,
        rawPrefix,
        listMarker: li.listMarker,
        hangIndent: li.hangIndent,
        taskState: li.taskState,
      });
      continue;
    }

    // Indented code: only outside a list. Look back at previous non-blank record at SAME prefix depth.
    if (INDENTED_CODE.test(content)) {
      const prevNonBlank = [...out].reverse().find(
        (c) => c.prefixes.length === prefixes.length && c.role !== "blank",
      );
      const insideList = prevNonBlank?.role === "list-item" || prevNonBlank?.role === "prose";
      // If the previous non-blank line at the same depth is a list-item or its prose
      // continuation, treat this as list-item continuation prose, not indented code.
      // Simpler heuristic: only call it indented-code if the previous non-blank is NOT
      // a list-item.
      if (prevNonBlank?.role === "list-item") {
        out.push({ prefixes, role: "prose", content, rawPrefix });
      } else if (insideList && prevNonBlank?.role === "prose") {
        // Prose under a list-item continues to be prose (continuation).
        // Indented-code only kicks in after we've returned to top-level prose.
        // For v1 simplicity: if any list-item appears in the run since the last blank,
        // treat indents as continuation. Cheap: scan back to last blank.
        const lastBlankIdx = [...out].map((c, i) => ({ c, i })).reverse().find(({ c }) => c.role === "blank")?.i ?? -1;
        const sinceBlank = out.slice(lastBlankIdx + 1);
        const inListContext = sinceBlank.some((c) => c.role === "list-item");
        out.push({ prefixes, role: inListContext ? "prose" : "indented-code", content, rawPrefix });
      } else {
        out.push({ prefixes, role: "indented-code", content, rawPrefix });
      }
      continue;
    }

    if (classifyHtmlBlockStart(content)) {
      out.push({ prefixes, role: "html-block", content, rawPrefix });
      continue;
    }

    // Default:
    out.push({ prefixes, role: "prose", content, rawPrefix });
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all classify tests pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat(classify): recognize headings, hr, lists, tasks, code, html"
```

---

## Task 10: Classifier — setext heading lookahead

**Files:**

- Modify: `src/lib/classify.ts`
- Modify: `test/classify.test.ts`

Setext detection requires looking at the next line. Both the heading text line and the underline line are tagged `heading-setext`. Setext does not apply if the prior line is itself a special role (list-item, blank, etc.) — only when the prior line is currently classified as `prose`.

- [ ] **Step 1: Add failing tests**

```ts
test("classify recognizes setext h1 (===) and tags both lines", () => {
  const r = classify("Title\n=====\n\npara");
  assert.equal(r[0].role, "heading-setext");
  assert.equal(r[1].role, "heading-setext");
  assert.equal(r[2].role, "blank");
  assert.equal(r[3].role, "prose");
});

test("classify recognizes setext h2 (---)", () => {
  const r = classify("Title\n-----");
  assert.equal(r[0].role, "heading-setext");
  assert.equal(r[1].role, "heading-setext");
});

test("--- after a blank line is HR, not setext", () => {
  const r = classify("para\n\n---");
  assert.equal(r[2].role, "hr");
});

test("--- under a list-item is HR, not setext", () => {
  const r = classify("- item\n---");
  // prior line is list-item, so --- can't be setext
  assert.equal(r[1].role, "hr");
});
```

- [ ] **Step 2: Run tests — new ones fail**

Run: `npm test`

- [ ] **Step 3: Add a setext lookahead pass**

Setext is easiest to handle as a post-pass: after the main classification loop builds `out`, walk through and convert `(prose, hr-or-prose-with-underline-content)` pairs to `heading-setext`. Add the import:

```ts
import { ..., SETEXT_UNDERLINE } from "./regex.js";
```

Add this helper above `classify`:

```ts
function applySetextPass(records: Classified[]): void {
  for (let i = 0; i < records.length - 1; i++) {
    const cur = records[i];
    const next = records[i + 1];
    // Setext only applies when current line is prose.
    if (cur.role !== "prose") continue;
    // The underline must be at the same blockquote depth.
    if (cur.prefixes.length !== next.prefixes.length) continue;
    if (!SETEXT_UNDERLINE.test(next.content)) continue;
    // Tag both lines.
    cur.role = "heading-setext";
    next.role = "heading-setext";
  }
}
```

Call it at the end of `classify`, just before `return out`:

```ts
  applySetextPass(out);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all classify tests pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat(classify): detect setext headings via post-pass"
```

---

## Task 11: Classifier — table detection

**Files:**

- Modify: `src/lib/classify.ts`
- Modify: `test/classify.test.ts`

A pipe-bearing line is a table-row when (a) the next line is a table separator (it's the header), (b) it IS a separator, or (c) it follows a separator and contains pipes (it's a body row), terminated by a blank line.

- [ ] **Step 1: Add failing tests**

```ts
test("classify recognizes a complete pipe table", () => {
  const r = classify("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nafter");
  assert.equal(r[0].role, "table-row");
  assert.equal(r[1].role, "table-row");
  assert.equal(r[2].role, "table-row");
  assert.equal(r[3].role, "table-row");
  assert.equal(r[4].role, "blank");
  assert.equal(r[5].role, "prose");
});

test("classify table without leading/trailing pipes", () => {
  const r = classify("a | b\n--- | ---\n1 | 2");
  assert.equal(r[0].role, "table-row");
  assert.equal(r[1].role, "table-row");
  assert.equal(r[2].role, "table-row");
});

test("classify lone pipe in prose is not a table", () => {
  const r = classify("foo | bar");
  assert.equal(r[0].role, "prose");
});
```

- [ ] **Step 2: Run tests — new ones fail**

Run: `npm test`

- [ ] **Step 3: Add a table post-pass**

Add `TABLE_SEPARATOR` to the imports. Add a helper above `classify`:

```ts
function applyTablePass(records: Classified[]): void {
  for (let i = 0; i < records.length; i++) {
    const cur = records[i];
    if (cur.role !== "prose") continue;
    if (!cur.content.includes("|")) continue;

    // Case A: cur is the header — next line is a separator at same depth.
    const next = records[i + 1];
    const nextIsSeparator =
      next &&
      next.prefixes.length === cur.prefixes.length &&
      TABLE_SEPARATOR.test(next.content);

    // Case B: cur is itself a separator.
    const curIsSeparator = TABLE_SEPARATOR.test(cur.content);

    if (nextIsSeparator || curIsSeparator) {
      // Mark cur and walk forward marking table-rows until blank/role-change/depth-change.
      cur.role = "table-row";
      let j = i + 1;
      while (j < records.length) {
        const r = records[j];
        if (r.prefixes.length !== cur.prefixes.length) break;
        if (r.role === "blank") break;
        if (r.role !== "prose" && r.role !== "table-row") break;
        if (!r.content.includes("|") && !TABLE_SEPARATOR.test(r.content)) break;
        r.role = "table-row";
        j++;
      }
      i = j - 1; // resume after the table
    }
  }
}
```

Call it after `applySetextPass`:

```ts
  applySetextPass(out);
  applyTablePass(out);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all classify tests pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat(classify): detect pipe tables via header+separator post-pass"
```

---

## Task 12: Classifier — hard-break detection

**Files:**

- Modify: `src/lib/classify.ts`
- Modify: `test/classify.test.ts`

A `prose` or `list-item` line ending in 2+ spaces gets `hardBreak: "spaces"`. A line ending in `\` gets `hardBreak: "backslash"`. Hard breaks do NOT apply to special roles (heading, hr, code, etc.) — only to lines that would otherwise be reflowed.

- [ ] **Step 1: Add failing tests**

```ts
test("classify detects hard break via trailing 2+ spaces", () => {
  const r = classify("foo  \nbar");
  assert.equal(r[0].role, "prose");
  assert.equal(r[0].hardBreak, "spaces");
  assert.equal(r[1].hardBreak, undefined);
});

test("classify detects hard break via trailing backslash", () => {
  const r = classify("foo\\\nbar");
  assert.equal(r[0].hardBreak, "backslash");
});

test("hard break only applies to reflow-eligible roles", () => {
  const r = classify("# heading  \n\n    code  ");
  assert.equal(r[0].role, "heading-atx");
  assert.equal(r[0].hardBreak, undefined);
  // line 1 is blank
  assert.equal(r[2].role, "indented-code");
  assert.equal(r[2].hardBreak, undefined);
});

test("hard break applies to list items", () => {
  const r = classify("- item one  \n- item two");
  assert.equal(r[0].role, "list-item");
  assert.equal(r[0].hardBreak, "spaces");
});
```

- [ ] **Step 2: Run tests — new ones fail**

Run: `npm test`

- [ ] **Step 3: Add hard-break detection**

Add to imports:

```ts
import { ..., HARD_BREAK_BACKSLASH, HARD_BREAK_SPACES } from "./regex.js";
```

After all other classification (after `applyTablePass`), add a final pass:

```ts
function applyHardBreakPass(records: Classified[]): void {
  for (const r of records) {
    if (r.role !== "prose" && r.role !== "list-item") continue;
    if (HARD_BREAK_SPACES.test(r.content)) {
      r.hardBreak = "spaces";
    } else if (HARD_BREAK_BACKSLASH.test(r.content)) {
      r.hardBreak = "backslash";
    }
  }
}
```

Call it after `applyTablePass`:

```ts
  applySetextPass(out);
  applyTablePass(out);
  applyHardBreakPass(out);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/classify.ts test/classify.test.ts
git commit -m "feat(classify): detect hard breaks (trailing spaces and backslash)"
```

---

## Task 13: Unwrap transform

**Files:**

- Create: `src/lib/unwrap.ts`
- Create: `test/unwrap.test.ts`

Implement `unwrap(text, { hyphenation, keepBlankLines })`. Algorithm per spec §"Unwrap algorithm".

- [ ] **Step 1: Write failing tests**

```ts
// test/unwrap.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrap } from "../src/lib/unwrap.js";

const dflt = { hyphenation: true, keepBlankLines: false };

test("unwrap joins consecutive prose lines with a single space", () => {
  const input = "alpha\nbeta\ngamma";
  assert.equal(unwrap(input, dflt), "alpha beta gamma");
});

test("unwrap preserves paragraph breaks via blank lines", () => {
  const input = "alpha\nbeta\n\ngamma\ndelta";
  assert.equal(unwrap(input, dflt), "alpha beta\n\ngamma delta");
});

test("unwrap collapses multiple blank lines by default", () => {
  const input = "alpha\n\n\n\nbeta";
  assert.equal(unwrap(input, dflt), "alpha\n\nbeta");
});

test("unwrap preserves blank-line runs when keepBlankLines is on", () => {
  const input = "alpha\n\n\nbeta";
  assert.equal(unwrap(input, { ...dflt, keepBlankLines: true }), "alpha\n\n\nbeta");
});

test("unwrap leaves fenced code untouched", () => {
  const input = "intro\n```\nline 1\nline 2\n```\nafter";
  assert.equal(unwrap(input, dflt), "intro\n```\nline 1\nline 2\n```\nafter");
});

test("unwrap leaves headings on their own line", () => {
  const input = "# Title\nbody one\nbody two";
  assert.equal(unwrap(input, dflt), "# Title\nbody one body two");
});

test("unwrap reflows blockquote content within depth", () => {
  const input = "> quote\n> continues here";
  assert.equal(unwrap(input, dflt), "> quote continues here");
});

test("unwrap respects nested blockquote depth", () => {
  const input = "> outer\n> > inner\n> > more inner";
  assert.equal(unwrap(input, dflt), "> outer\n> > inner more inner");
});

test("unwrap merges list-item continuation lines", () => {
  const input = "- item one\n  continues\n- item two";
  assert.equal(unwrap(input, dflt), "- item one continues\n- item two");
});

test("unwrap strips soft hyphens when enabled", () => {
  const input = "an inter-\nesting word";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "an interesting word");
});

test("unwrap preserves intentional compounds", () => {
  // The hyphen rule only fires on `[a-z]-` — capital before hyphen is preserved.
  const input = "state-of-the-art";
  assert.equal(unwrap(input, { ...dflt, hyphenation: true }), "state-of-the-art");
});

test("unwrap with hyphenation off keeps the hyphen", () => {
  const input = "an inter-\nesting word";
  assert.equal(unwrap(input, { ...dflt, hyphenation: false }), "an inter- esting word");
});

test("unwrap protects inline code from joins", () => {
  const input = "see `foo bar`\ndocs";
  assert.equal(unwrap(input, dflt), "see `foo bar` docs");
});

test("unwrap protects inline links", () => {
  const input = "go to [the docs](https://x.test/a b)\nplease";
  assert.equal(unwrap(input, dflt), "go to [the docs](https://x.test/a b) please");
});

test("unwrap preserves hard-break-terminated lines", () => {
  const input = "line one  \nline two";
  // The hard-break terminates the reflow group.
  assert.equal(unwrap(input, dflt), "line one  \nline two");
});

test("unwrap handles empty input", () => {
  assert.equal(unwrap("", dflt), "");
});

test("unwrap normalizes CRLF line endings", () => {
  assert.equal(unwrap("a\r\nb\r\nc", dflt), "a b c");
});
```

- [ ] **Step 2: Run tests — they fail**

Run: `npm test`

- [ ] **Step 3: Implement `src/lib/unwrap.ts`**

```ts
// src/lib/unwrap.ts
import { classify, type Classified } from "./classify.js";
import { HYPHEN_BREAK_END } from "./regex.js";

export type UnwrapOptions = {
  hyphenation: boolean;
  keepBlankLines: boolean;
};

const REFLOWABLE_ROLES = new Set<Classified["role"]>(["prose", "list-item"]);

function samePrefixStack(a: Classified, b: Classified): boolean {
  if (a.prefixes.length !== b.prefixes.length) return false;
  for (let i = 0; i < a.prefixes.length; i++) {
    if (a.prefixes[i].marker !== b.prefixes[i].marker) return false;
    if (a.prefixes[i].spaceAfter !== b.prefixes[i].spaceAfter) return false;
  }
  return true;
}

/** Build the prefix string used for re-emission. */
function emitPrefix(prefixes: Classified["prefixes"]): string {
  return prefixes.map((p) => (p.spaceAfter ? "> " : ">")).join("");
}

/** Continuation prefix for wrapped list-item content (blockquote chain + hang spaces). */
function continuationPrefix(prefixes: Classified["prefixes"], hangIndent: number): string {
  return emitPrefix(prefixes) + " ".repeat(hangIndent);
}

function joinWithHyphenation(prior: string, next: string, hyphenation: boolean): string {
  if (hyphenation && HYPHEN_BREAK_END.test(prior) && /^[a-z]/.test(next)) {
    return prior.slice(0, -1) + next;
  }
  return prior + " " + next;
}

type Group = {
  /** Header line — defines prefix stack, list marker, etc. */
  header: Classified;
  /** Concatenated content (with hyphenation already applied as we accumulate). */
  joined: string;
  /** True when the group ended with a hard break — emit marker verbatim, then \n. */
  endHardBreak?: "spaces" | "backslash";
  /** True when this group is just a passthrough (preserve-as-is or html). */
  passthrough?: boolean;
  /** For passthrough groups, the raw line emitted as-is (with prefix). */
  raw?: string;
};

function emitGroup(g: Group): string {
  if (g.passthrough) return g.raw ?? "";
  const prefix = emitPrefix(g.header.prefixes);
  if (g.header.role === "list-item") {
    const marker = g.header.listMarker ?? "-";
    const taskPrefix = g.header.taskState !== undefined ? `[${g.header.taskState}] ` : "";
    return `${prefix}${marker} ${taskPrefix}${g.joined}`;
  }
  return prefix + g.joined;
}

export function unwrap(text: string, opts: UnwrapOptions): string {
  if (text === "") return "";
  const records = classify(text);

  type Output = { kind: "group"; group: Group } | { kind: "blank"; rawPrefix: string };
  const output: Output[] = [];

  let current: Group | null = null;

  const flush = () => {
    if (current) {
      output.push({ kind: "group", group: current });
      current = null;
    }
  };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];

    // Blank lines flush the current group and emit a blank.
    if (rec.role === "blank") {
      flush();
      output.push({ kind: "blank", rawPrefix: rec.rawPrefix });
      continue;
    }

    // Preserve-as-is roles flush + emit verbatim.
    if (!REFLOWABLE_ROLES.has(rec.role)) {
      flush();
      output.push({
        kind: "group",
        group: { header: rec, joined: "", passthrough: true, raw: rec.rawPrefix + rec.content },
      });
      continue;
    }

    // rec is prose or list-item. Decide: continue current group, or start new.
    let canContinue = false;
    if (current && samePrefixStack(rec, current.header) && !current.endHardBreak) {
      if (rec.role === "list-item") {
        // A new list-item starts a new group, even if same prefix.
        canContinue = false;
      } else {
        // rec is prose. Continue if header is prose, or list-item (continuation).
        canContinue = current.header.role === "prose" || current.header.role === "list-item";
      }
    }

    if (!canContinue) {
      flush();
      const headerJoined = rec.role === "list-item" ? rec.content : rec.content;
      current = { header: rec, joined: headerJoined };
    } else {
      // Append rec.content to current.joined with hyphenation rule.
      // BUT first: if current ended in a hard break, we already flushed above.
      current!.joined = joinWithHyphenation(current!.joined, rec.content, opts.hyphenation);
    }

    if (rec.hardBreak) {
      current!.endHardBreak = rec.hardBreak;
    }
  }
  flush();

  // Render output, applying inline-token protection per group.
  const lines: string[] = [];
  for (let i = 0; i < output.length; i++) {
    const o = output[i];
    if (o.kind === "blank") {
      // Collapse runs unless keepBlankLines is on.
      if (!opts.keepBlankLines && lines.length > 0 && lines[lines.length - 1] === "") {
        continue;
      }
      lines.push("");
      continue;
    }
    const g = o.group;
    if (g.passthrough) {
      lines.push(g.raw ?? "");
      continue;
    }
    // Hard-break markers are already on g.joined because we accumulated rec.content
    // verbatim during grouping (so trailing 2-spaces or trailing backslash survive).
    // Inline tokens were never split during grouping (since we only joined whole
    // rec.content strings with single spaces), so no protection is needed at this
    // stage — protection matters during *wrap*, not unwrap. Just emit.
    lines.push(emitGroup(g));
  }

  // Trim trailing blank line if we ended on one.
  while (lines.length > 0 && lines[lines.length - 1] === "" && !opts.keepBlankLines) {
    lines.pop();
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all unwrap tests pass. If any fail, read the actual vs expected output, find the discrepancy, and adjust either the implementation or (if the test was wrong) the test. **Do not weaken tests to make them pass.**

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/unwrap.ts test/unwrap.test.ts
git commit -m "feat: add unwrap transform with classifier-driven reflow"
```

---

## Task 14: Wrap transform

**Files:**

- Create: `src/lib/wrap.ts`
- Create: `test/wrap.test.ts`

Implement `wrap(text, { width })`. Algorithm per spec §"Wrap algorithm" — `width` is the full-line budget; per-line content budget is `width - prefixLen`.

- [ ] **Step 1: Write failing tests**

```ts
// test/wrap.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrap } from "../src/lib/wrap.js";

const W = (n: number) => ({ width: n });

test("wrap returns short input unchanged", () => {
  assert.equal(wrap("short", W(80)), "short");
});

test("wrap respects column budget on plain prose", () => {
  const input = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
  const out = wrap(input, W(20));
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 20, `line too long: ${line.length} chars: ${JSON.stringify(line)}`);
  }
  // round trip: joining lines with a space gives back the input
  assert.equal(out.split("\n").join(" "), input);
});

test("wrap leaves fenced code untouched even when long", () => {
  const longCode = "this_is_a_very_long_line_inside_a_code_fence_that_should_not_be_wrapped";
  const input = "```\n" + longCode + "\n```";
  const out = wrap(input, W(40));
  assert.ok(out.includes(longCode));
});

test("wrap preserves headings on their own line", () => {
  const input = "# A short heading\nbody text here";
  const out = wrap(input, W(40));
  assert.equal(out.split("\n")[0], "# A short heading");
});

test("wrap respects width INCLUDING blockquote prefix", () => {
  const input = "> alpha beta gamma delta epsilon zeta eta";
  const out = wrap(input, W(20));
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 20, `line too long: ${JSON.stringify(line)}`);
    assert.ok(line.startsWith("> "), `lost quote prefix: ${JSON.stringify(line)}`);
  }
});

test("wrap respects width INCLUDING list marker + hang", () => {
  const input = "- alpha beta gamma delta epsilon zeta eta theta";
  const out = wrap(input, W(20));
  const lines = out.split("\n");
  for (const line of lines) {
    assert.ok(line.length <= 20, `line too long: ${JSON.stringify(line)}`);
  }
  // First line starts with "- "; continuations indent 2 spaces.
  assert.ok(lines[0].startsWith("- "));
  for (let i = 1; i < lines.length; i++) {
    assert.ok(lines[i].startsWith("  "), `continuation lacks hang: ${JSON.stringify(lines[i])}`);
  }
});

test("wrap never breaks inside an inline code span", () => {
  const input = "use `inline_code_with_underscores` for stuff";
  const out = wrap(input, W(20));
  // The full code span must survive on a single line, even if it pushes the line over budget.
  assert.ok(out.includes("`inline_code_with_underscores`"));
});

test("wrap never breaks inside an inline link", () => {
  const input = "see [the docs](https://example.com/very/long/path) please";
  const out = wrap(input, W(20));
  assert.ok(out.includes("[the docs](https://example.com/very/long/path)"));
});

test("wrap with width<20 clamps to 20", () => {
  const input = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
  const out = wrap(input, { width: 5 });
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 20, `line too long: ${line.length}`);
  }
});

test("wrap emits oversized token alone (no mid-word break)", () => {
  const tok = "supercalifragilisticexpialidocious";
  const input = `before ${tok} after`;
  const out = wrap(input, W(20));
  // The token line will be > 20; this is acceptable.
  assert.ok(out.includes(tok));
  for (const line of out.split("\n")) {
    if (!line.includes(tok)) {
      assert.ok(line.length <= 20, `non-oversized line too long: ${JSON.stringify(line)}`);
    }
  }
});

test("wrap handles empty input", () => {
  assert.equal(wrap("", W(80)), "");
});
```

- [ ] **Step 2: Run tests — they fail**

Run: `npm test`

- [ ] **Step 3: Implement `src/lib/wrap.ts`**

```ts
// src/lib/wrap.ts
import { classify, type Classified } from "./classify.js";
import { protectInline, restoreInline } from "./inline.js";

export type WrapOptions = {
  width: number;
};

const MIN_WIDTH = 20;
const REFLOWABLE_ROLES = new Set<Classified["role"]>(["prose", "list-item"]);

function emitPrefix(prefixes: Classified["prefixes"]): string {
  return prefixes.map((p) => (p.spaceAfter ? "> " : ">")).join("");
}

/** First-line prefix for a list-item (quote chain + marker + space + task box if any). */
function listItemFirstPrefix(rec: Classified): string {
  const quote = emitPrefix(rec.prefixes);
  const marker = rec.listMarker ?? "-";
  const task = rec.taskState !== undefined ? `[${rec.taskState}] ` : "";
  return `${quote}${marker} ${task}`;
}

/** Continuation prefix for a list-item (quote chain + hang spaces). */
function listItemContPrefix(rec: Classified): string {
  const quote = emitPrefix(rec.prefixes);
  return quote + " ".repeat(rec.hangIndent ?? 2);
}

/** Greedy word fill — returns lines (without prefixes). Tokens are joined with single spaces. */
function greedyFill(tokens: string[], firstBudget: number, contBudget: number): string[] {
  if (tokens.length === 0) return [""];
  const lines: string[] = [];
  let cur = tokens[0];
  let curBudget = firstBudget;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    // +1 for the joining space.
    if (cur.length + 1 + t.length <= curBudget) {
      cur += " " + t;
    } else {
      lines.push(cur);
      cur = t;
      curBudget = contBudget;
    }
  }
  lines.push(cur);
  return lines;
}

/** Tokenize content into space-separated tokens, treating protected inline placeholders as atomic. */
function tokenizeContent(content: string): string[] {
  return content.split(/\s+/).filter((t) => t.length > 0);
}

export function wrap(text: string, opts: WrapOptions): string {
  if (text === "") return "";
  const widthRaw = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 80;
  const width = Math.max(MIN_WIDTH, widthRaw);

  const records = classify(text);
  const out: string[] = [];

  // Group consecutive reflowable lines (prose or list-item with continuation).
  let i = 0;
  while (i < records.length) {
    const rec = records[i];

    if (rec.role === "blank") {
      out.push(rec.rawPrefix);
      i++;
      continue;
    }

    if (!REFLOWABLE_ROLES.has(rec.role)) {
      // Passthrough: emit verbatim with its prefix.
      out.push(rec.rawPrefix + rec.content);
      i++;
      continue;
    }

    // rec is prose or list-item. Decide first-line vs continuation budgets.
    let firstPrefix: string;
    let contPrefix: string;
    if (rec.role === "list-item") {
      firstPrefix = listItemFirstPrefix(rec);
      contPrefix = listItemContPrefix(rec);
    } else {
      firstPrefix = emitPrefix(rec.prefixes);
      contPrefix = firstPrefix;
    }

    // Collect content from this group: this line, plus following prose at same prefix stack
    // (with no intervening blank, no special role, no hard-break terminator).
    let combined = rec.content;
    let endsWithHardBreak = rec.hardBreak;
    let j = i + 1;
    while (j < records.length && !endsWithHardBreak) {
      const next = records[j];
      if (next.role !== "prose") break;
      if (next.prefixes.length !== rec.prefixes.length) break;
      // For list-item: a following prose line is a continuation regardless of indent
      // (we already stripped indent during classify; if it's prose at same depth and not
      // separated by a blank, it's continuation).
      combined += " " + next.content;
      if (next.hardBreak) endsWithHardBreak = next.hardBreak;
      j++;
    }
    i = j;

    // Protect inline tokens, tokenize, fill, restore.
    const { protected: prot, tokens } = protectInline(combined);
    const wordTokens = tokenizeContent(prot);
    const firstBudget = Math.max(1, width - firstPrefix.length);
    const contBudget = Math.max(1, width - contPrefix.length);
    const filled = greedyFill(wordTokens, firstBudget, contBudget);
    const lines = filled.map((line, idx) => {
      const restored = restoreInline(line, tokens);
      return idx === 0 ? firstPrefix + restored : contPrefix + restored;
    });
    out.push(...lines);
  }

  return out.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all wrap tests pass.

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/lib/wrap.ts test/wrap.test.ts
git commit -m "feat: add wrap transform with prefix-aware width budget"
```

---

## Task 15: Wire entry points

**Files:**

- Modify: `src/wrap-text.ts` (currently a date-stub)
- Modify: `src/unwrap-text.ts` (currently a date-stub)

Replace the existing stubs with thin wrappers that call the pipeline.

- [ ] **Step 1: Replace `src/wrap-text.ts`**

```ts
// src/wrap-text.ts
import { getPreferenceValues } from "@raycast/api";
import {
  type BaseLaunchContext,
  NoTextError,
  OversizeError,
  deliver,
  failureToast,
  guardSize,
  parseWidth,
  readContent,
  type LaunchProps,
} from "./lib/pipeline.js";
import { wrap } from "./lib/wrap.js";

type WrapContext = BaseLaunchContext & {
  width?: number;
};

export default async function Command(props: LaunchProps<{ launchContext?: WrapContext }>) {
  const prefs = getPreferenceValues<Preferences.WrapText>();
  try {
    const input = props.launchContext?.text ?? (await readContent(prefs.source));
    guardSize(input);
    const width = props.launchContext?.width ?? parseWidth(prefs.width);
    const result = wrap(input, { width });
    await deliver({
      launchContext: props.launchContext,
      prefs: { action: prefs.action, hideHUD: prefs.hideHUD, popToRoot: prefs.popToRoot },
      result,
      noun: "wrapped",
    });
  } catch (error) {
    if (error instanceof NoTextError) {
      await failureToast("No text available", "Select text or copy it to the clipboard.");
    } else if (error instanceof OversizeError) {
      await failureToast("Text exceeds 1MB limit", "Use a text editor for documents this large.");
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      await failureToast("Failed to wrap text", message);
    }
  }
}
```

- [ ] **Step 2: Replace `src/unwrap-text.ts`**

```ts
// src/unwrap-text.ts
import { getPreferenceValues } from "@raycast/api";
import {
  type BaseLaunchContext,
  NoTextError,
  OversizeError,
  deliver,
  failureToast,
  guardSize,
  readContent,
  type LaunchProps,
} from "./lib/pipeline.js";
import { unwrap } from "./lib/unwrap.js";

type UnwrapContext = BaseLaunchContext & {
  hyphenation?: boolean;
  keepBlankLines?: boolean;
};

export default async function Command(props: LaunchProps<{ launchContext?: UnwrapContext }>) {
  const prefs = getPreferenceValues<Preferences.UnwrapText>();
  try {
    const input = props.launchContext?.text ?? (await readContent(prefs.source));
    guardSize(input);
    const hyphenation = props.launchContext?.hyphenation ?? prefs.hyphenation;
    const keepBlankLines = props.launchContext?.keepBlankLines ?? prefs.keepBlankLines;
    const result = unwrap(input, { hyphenation, keepBlankLines });
    await deliver({
      launchContext: props.launchContext,
      prefs: { action: prefs.action, hideHUD: prefs.hideHUD, popToRoot: prefs.popToRoot },
      result,
      noun: "unwrapped",
    });
  } catch (error) {
    if (error instanceof NoTextError) {
      await failureToast("No text available", "Select text or copy it to the clipboard.");
    } else if (error instanceof OversizeError) {
      await failureToast("Text exceeds 1MB limit", "Use a text editor for documents this large.");
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      await failureToast("Failed to unwrap text", message);
    }
  }
}
```

- [ ] **Step 3: Build to verify the auto-generated `Preferences.WrapText` / `Preferences.UnwrapText` shapes line up**

Run: `npm run build`
Expected: succeeds. If TypeScript complains about `Preferences.WrapText` not existing, it's because Raycast generates `Preferences` namespacing differently — open `raycast-env.d.ts` and adjust the import name to match (it may emit `Preferences` per command via a different convention; trust the generated file).

- [ ] **Step 4: Smoke-test with `npm run dev`**

Run: `npm run dev`

In Raycast: invoke "Wrap Text" with some prose on the clipboard and width=40. Verify:
- The HUD shows "Pasted wrapped text" (or "Copied wrapped text" depending on the Primary Action preference).
- The output appears in the focused app (or stays on the clipboard if action=copy).
- Run "Unwrap Text" on the same wrapped output and verify it reflows back to a single paragraph.

Stop dev mode (Ctrl+C in the terminal).

- [ ] **Step 5: Commit**

```bash
npx ray lint --fix
git add src/wrap-text.ts src/unwrap-text.ts
git commit -m "feat: wire wrap-text and unwrap-text entry points"
```

---

## Task 16: Manual test fixtures

**Files:**

- Create: `test-fixtures/01-prose-paragraphs.md`
- Create: `test-fixtures/02-headings.md`
- Create: `test-fixtures/03-bullets-and-lists.md`
- Create: `test-fixtures/04-blockquotes.md`
- Create: `test-fixtures/05-fenced-code.md`
- Create: `test-fixtures/06-indented-code.md`
- Create: `test-fixtures/07-inline-code-and-links.md`
- Create: `test-fixtures/08-tables.md`
- Create: `test-fixtures/09-html-blocks.md`
- Create: `test-fixtures/10-link-ref-defs.md`
- Create: `test-fixtures/11-hyphenation.md`
- Create: `test-fixtures/12-hard-breaks.md`
- Create: `test-fixtures/13-mixed-realistic.md`
- Create: `test-fixtures/14-edge-cases.md`

Each fixture is a small Markdown file with an HTML-comment header describing the input shape and expected behavior.

- [ ] **Step 1: Create all 14 fixtures**

Use this template structure for each (adjusting body content):

```md
<!--
WRAP/UNWRAP TEST FIXTURE — <topic>
Input: <one-line description of what's in this file>
Expected on Wrap (width=40): <one-sentence behavior description>
Expected on Unwrap: <one-sentence behavior description>
-->

<actual content goes here>
```

For each file, write a representative example. Below are the bodies — keep each fixture under 30 lines.

**`01-prose-paragraphs.md`**

```md
<!--
FIXTURE — prose paragraphs
Input: three paragraphs of unwrapped prose separated by blank lines
Expected on Wrap (width=40): each paragraph wraps at 40 cols, blank lines preserved
Expected on Unwrap: paragraphs stay separate; lines within each paragraph join into one
-->

The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.

A second paragraph that should remain distinct. It also has multiple sentences and should reflow as one logical line.

A third paragraph for good measure.
```

**`02-headings.md`**

```md
<!--
FIXTURE — ATX and setext headings
Input: ATX h1-h3, setext h1 and h2, with prose between
Expected on Wrap: headings stay on their own line; only prose reflows
Expected on Unwrap: headings stay on their own line; prose paragraphs collapse to one line each
-->

# An ATX heading

Some prose under the heading that may need to be reflowed depending on width.

## Another ATX heading

A Setext H1
===========

Body of setext h1.

A Setext H2
-----------

Body of setext h2.
```

**`03-bullets-and-lists.md`**

```md
<!--
FIXTURE — lists
Input: dashed bullets, asterisk bullets, plus bullets, ordered lists, task lists, nested
Expected on Wrap: list markers preserved, hang indent on continuations
Expected on Unwrap: continuation lines merge into the parent item
-->

- A dash bullet that is long enough to wrap if width is small
- Another dash bullet
  with a continuation line

* Asterisk bullets
+ Plus bullets

1. First ordered
2. Second ordered
10) Tenth ordered with paren style

- [ ] An unchecked task
- [x] A checked task
- [X] Capital X also works

- Outer
  - Nested under outer
    - Deeper still
```

**`04-blockquotes.md`**

```md
<!--
FIXTURE — blockquotes
Input: single-level, nested, quote-with-list, quote-with-code
Expected on Wrap: quote markers preserved on every output line; width includes them
Expected on Unwrap: lines within the same quote depth merge; depth changes break groups
-->

> A single-level quote that should reflow when wrapped or unwrapped.
> Continues here.

> Outer quote
> > Nested quote with its own paragraph
> > continuing here.

> - A bullet inside a quote
>   with a continuation line
> - A second bullet

> ```
> code inside a quote
> stays put
> ```
```

**`05-fenced-code.md`**

```md
<!--
FIXTURE — fenced code blocks
Input: backtick fences and tilde fences with content that LOOKS like prose/lists/tables
Expected on Wrap: every line inside a fence is preserved verbatim, even when long
Expected on Unwrap: nothing inside a fence is reflowed
-->

intro paragraph

```js
function thisIsAVeryLongFunctionNameThatShouldNotBeWrappedNoMatterWhat() {
  return "stay put";
}
```

between fences

~~~
- this looks like a list but is inside a fence
1. and so is this
| not | a | table |
~~~

after
```

**`06-indented-code.md`**

```md
<!--
FIXTURE — indented code
Input: 4-space indented code outside a list, 4-space indent inside a list (continuation)
Expected on Wrap: top-level indented code preserved; list continuations reflow
Expected on Unwrap: same — indented code stays put
-->

para before

    indented_code_line_one
    indented_code_line_two

para after

- list item
    continuation under the bullet (4 spaces)
- next item
```

**`07-inline-code-and-links.md`**

```md
<!--
FIXTURE — inline code and links
Input: prose containing code spans, inline links, ref links, autolinks
Expected on Wrap (width=40): inline tokens never split across lines, even when oversized
Expected on Unwrap: tokens stay intact across joins
-->

See `function_with_long_name` for details. Also visit [the documentation](https://example.com/very/long/path) for more.

A reference link [like this][ref] and an autolink <https://example.com/something>.

[ref]: https://example.com/ref
```

**`08-tables.md`**

```md
<!--
FIXTURE — pipe tables
Input: a complete pipe table with header, separator, and body
Expected on Wrap: every table line preserved verbatim (no reflow)
Expected on Unwrap: same
-->

before

| Column A | Column B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |

after
```

**`09-html-blocks.md`**

```md
<!--
FIXTURE — HTML blocks and comments
Input: a div block, an inline comment
Expected on Wrap: HTML block lines preserved; surrounding prose reflows
Expected on Unwrap: same
-->

before paragraph

<div>
hello inside a div
</div>

<!-- a comment -->

after paragraph
```

**`10-link-ref-defs.md`**

```md
<!--
FIXTURE — reference link definitions
Input: prose using ref links plus a defs block at the bottom
Expected on Wrap: each definition stays on its own line; prose reflows
Expected on Unwrap: definitions stay on their own lines; prose paragraphs join
-->

This is a paragraph that uses [a ref link][one] and [another][two] for context.

[one]: https://example.com/one
[two]: https://example.com/two "with a title"
```

**`11-hyphenation.md`**

```md
<!--
FIXTURE — hyphenation
Input: soft-broken words and intentional compound words
Expected on Unwrap with hyphenation ON: `inter-` + `esting` -> `interesting`; compounds preserved
Expected on Unwrap with hyphenation OFF: hyphens preserved verbatim with single space join
-->

This is an inter-
esting test of soft hyphens that should join cleanly.

State-of-the-art compound words should not be flattened.

A cross-platform tool runs every-
where, but should not become "everywhere" if the next char is a different word.
```

**`12-hard-breaks.md`**

```md
<!--
FIXTURE — hard breaks
Input: trailing-2-space hard breaks and trailing-backslash hard breaks
Expected on Wrap/Unwrap: hard breaks terminate reflow groups; markers preserved
-->

line one  
line two after a 2-space hard break

line three\
line four after a backslash hard break

next paragraph
```

**`13-mixed-realistic.md`**

```md
<!--
FIXTURE — realistic doc with most features combined
Input: a chunk that mixes headings, prose, lists, code, links
Expected: classifier handles the combination without bleeding roles into each other
-->

# Project README

This is a paragraph that introduces the project. It can be quite long and benefit from re-flowing.

## Installation

Run the following:

```bash
npm install awesome-thing
```

Then configure it:

- Edit `~/.config/awesome.toml`
- Set `mode = "production"`
- Restart the daemon

> Note: see [the docs](https://example.com/docs) for advanced setup.

| Option | Default |
| --- | --- |
| `mode` | `"production"` |
| `port` | `8080` |
```

**`14-edge-cases.md`**

```md
<!--
FIXTURE — edge cases
Input: empty paragraphs, single blank lines, whitespace-only lines, no trailing newline, very long single-token line
Expected on Wrap/Unwrap: graceful handling, no crashes, no infinite loops
-->

   

A_single_extremely_long_token_with_no_spaces_that_definitely_exceeds_any_reasonable_wrap_width_limit_set_by_the_user

After the long token.
```

- [ ] **Step 2: Verify all 14 files exist**

Run: `ls test-fixtures/ | wc -l`
Expected: `14`.

- [ ] **Step 3: Manual smoke against fixtures**

Run: `npm run dev`

For each fixture, copy its body (without the HTML-comment header) to clipboard, run **Wrap Text** then **Unwrap Text**, and confirm the result matches the "Expected" line in the header. Note any discrepancies — these are the inputs you'll iterate on after v1 is in your hands.

(This step is exploratory, not pass/fail. The point is to verify nothing crashes and the obvious cases work; subtle reflow issues are expected and will be tuned in follow-ups.)

- [ ] **Step 4: Commit**

```bash
npx ray lint --fix
git add test-fixtures/
git commit -m "test: add 14 manual evaluation fixtures"
```

---

## Task 17: README and CHANGELOG

**Files:**

- Create: `README.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `README.md`**

```md
# Wrap Unwrap

Reflow text to or from wrapped form, with Markdown awareness. Two `no-view` commands you can hotkey-bind:

- **Wrap Text** — wrap the selected text (or clipboard text) at a configurable column width.
- **Unwrap Text** — reflow wrapped text into continuous paragraphs, preserving Markdown structure (code fences, lists, blockquotes, tables, links, hyphenation).

The classifier recognizes paragraphs, ATX and setext headings, fenced and indented code, blockquotes (with nesting), bullet/ordered/task lists, pipe tables, HTML blocks, reference link definitions, and hard breaks. Unwrap groups by blockquote prefix and inner role, so `> - item` reflows as a list item under a quote without losing structure.

## Commands

| Command | Description |
| --- | --- |
| Wrap Text | Wrap text at a configurable column width. |
| Unwrap Text | Reflow wrapped text into continuous paragraphs while preserving Markdown structure. |

## Preferences

Both commands share **Preferred Source**, **Primary Action**, **Hide HUD**, and **Pop to Root After Action**:

| Preference | Default | What it does |
| --- | --- | --- |
| Preferred Source | Selected Text | Try the selection first; fall back to the clipboard if none. Choose Clipboard to flip the priority. |
| Primary Action | Paste | Paste the result into the focused app. Choose Copy to put the result on the clipboard instead. |
| Hide HUD | off | Suppress the success HUD ("Pasted wrapped text" / "Copied unwrapped text"). |
| Pop to Root After Action | off | Return to Raycast root after the action completes. (No-op when launched via hotkey.) |

**Wrap Text** also has:

| Preference | Default | What it does |
| --- | --- | --- |
| Wrap Column | 80 | The column at which lines are wrapped. The wrap budget is the *full* line including blockquote and list-item prefixes. Width values below 20 are clamped to 20. |

**Unwrap Text** also has:

| Preference | Default | What it does |
| --- | --- | --- |
| Strip Soft Hyphens | on | When joining lines, remove a trailing hyphen if it appears to be a soft line-break hyphen (e.g. `inter-` + `esting` → `interesting`). Compounds like `state-of-the-art` are preserved. |
| Keep Blank Lines | off | Preserve blank lines between paragraphs instead of collapsing runs. |

## Suggested hotkeys

Bind these in Raycast → Extensions → Wrap Unwrap. Suggestions:

- Wrap Text → ⌃⌥W
- Unwrap Text → ⌃⌥U

## For other extensions

Wrap Unwrap implements the [LitoMore cross-extension convention](https://github.com/LitoMore/raycast-cross-extension-conventions) on the provider side using only built-in Raycast SDK primitives. Pass a `launchContext` with the text and an optional `callbackLaunchOptions` describing where to send the result:

```ts
import { LaunchType, launchCommand } from "@raycast/api";

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

The provider invokes your callback command with `context: { result: "..." }` containing the transformed text. When `callbackLaunchOptions` is present, the provider does not paste, copy, or show a HUD — it just hands the result back.

`UnwrapContext` accepts `text`, `hyphenation`, `keepBlankLines`, and `callbackLaunchOptions`. `WrapContext` accepts `text`, `width`, and `callbackLaunchOptions`.

## Acknowledgements

The Preferred Source / Primary Action preference pattern follows the popular [Change Case](https://www.raycast.com/erics118/change-case) extension's convention.
```

- [ ] **Step 2: Write `CHANGELOG.md`**

```md
# Wrap Unwrap Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Add **Wrap Text** command — wrap text at a configurable column width with Markdown awareness.
- Add **Unwrap Text** command — reflow wrapped text into continuous paragraphs, preserving Markdown structure.
- Shared preferences: Preferred Source, Primary Action, Hide HUD, Pop to Root.
- Wrap-only preference: Wrap Column.
- Unwrap-only preferences: Strip Soft Hyphens, Keep Blank Lines.
- Cross-extension provider support via `launchCommand` callback (LitoMore convention).
```

- [ ] **Step 3: Final lint and build**

Run:

```bash
npx ray lint --fix
npm run build
npm test
```

Expected: lint passes, build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: add README and CHANGELOG for v1"
```

---

## Self-review

Before handing off to executing-plans:

- [ ] **Spec coverage check.** For each section in the spec, identify the task that implements it:
  - Goal / Non-goals → Tasks 1, 13, 14, 15
  - Pipeline (acquire / guard / transform / deliver) → Task 4
  - Error toasts (Copy Error contract) → Task 4 (`failureToast`), Task 15 (entry-point catch blocks)
  - Type & API rules → Conventions section + Task 15 (uses `Preferences.WrapText` / `Preferences.UnwrapText` from auto-gen)
  - Preferences (extension + per-command manifest) → Task 1
  - Wrap algorithm (width contract, greedy fill, edges) → Task 14
  - Unwrap algorithm (reflow groups, hyphenation, hard breaks) → Task 13
  - Line classifier (output shape + per-role recognizers + hard-break + setext + tables) → Tasks 6-12
  - Platform support → Task 1 (`platforms: ["macOS"]`)
  - File layout → matches spec
  - Cross-extension contract → Task 4 (`CallbackOptions` and `deliver`), Task 15 (entry-point launchContext acceptance)
  - README / CHANGELOG → Task 17
  - Test fixtures → Task 16
  - Automated tests → Tasks 2-14 (one test file per pure module)

- [ ] **Placeholder scan.** No "TBD", no "implement later", no bare "add validation". Each step has either real code, a real command, or both.

- [ ] **Type consistency.** `Classified.role` values used by `unwrap`/`wrap` (`"prose"`, `"list-item"`, `"blank"`) match the union in `classify.ts`. `BaseLaunchContext` is consistent across `pipeline.ts` and entry points. `failureToast` signature matches between `pipeline.ts` and entry-point call sites.
