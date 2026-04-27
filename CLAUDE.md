# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Raycast extension ("Wrap Unwrap") that wraps and unwraps text with Markdown awareness. Two `no-view` commands:

- `wrap-text` (`src/wrap-text.ts`) — Wrap Text. Wraps lines at a configurable column width, prefix-aware (blockquote `> `, list-item `- ` + hang count toward the budget).
- `unwrap-text` (`src/unwrap-text.ts`) — Unwrap Text. Reflows wrapped text into single lines, preserving Markdown structure.

Both commands share the Change Case-style preferences: **Preferred Source** (selection vs clipboard), **Primary Action** (paste vs copy), **Hide HUD**, **Pop to Root**. Wrap adds **Wrap Column**. Unwrap adds **Strip Soft Hyphens** and **Keep Blank Lines**.

The spec is at `docs/superpowers/specs/2026-04-25-wrap-unwrap-design.md`. The implementation plan is at `docs/superpowers/plans/2026-04-25-wrap-unwrap-v1.md`.

## Commands

- `npm run dev` — `ray develop` (live-reload into Raycast)
- `npm run build` — `ray build`
- `npm run lint` — `ray lint`
- `npm run fix-lint` — `ray lint --fix` (run this before every commit — it formats code AND markdown via Prettier)
- `npm test` — `tsx --test test/*.test.ts` (Node's built-in test runner via `tsx`)
- `npm run publish` — publish to the Raycast Store

## Architecture

The extension is built around a thin pipeline + a pure-function transform layer.

```
src/
  wrap-text.ts            # entry — acquire → guard → wrap → deliver
  unwrap-text.ts          # entry — acquire → guard → unwrap → deliver
  lib/
    pipeline.ts           # readContent, guardSize, deliver, failureToast, parseWidth, NoTextError, OversizeError
    classify.ts           # classify(text) → Classified[] — blockquote prefixes + inner role + extras
    inline.ts             # protectInline / restoreInline — atomic placeholders for code spans, links, autolinks
    regex.ts              # named regex constants used by the classifier
    wrap.ts               # wrap(text, { width })
    unwrap.ts             # unwrap(text, { hyphenation, keepBlankLines })

test/                     # node:test unit tests, one file per pure module
test-fixtures/            # 14 manual evaluation fixtures for `npm run dev`
```

### Classifier shape

`classify(text)` returns one `Classified` record per line. Each record has:

- `prefixes: BlockquoteFrame[]` — outer-to-inner blockquote frames. Depth = `prefixes.length`.
- `role: InnerRole` — one of `blank`, `fence-boundary`, `in-fence`, `indented-code`, `heading-atx`, `heading-setext`, `hr`, `list-item`, `table-row`, `html-block`, `link-ref-def`, `prose`.
- `content` — line content with blockquote prefixes stripped. **Special case:** for `list-item` records, `content` is also stripped of marker, gap, and task checkbox.
- `rawPrefix` — the verbatim blockquote prefix string for round-trip emission.
- Optional role-specific extras: `listMarker`, `listIndent`, `listGap`, `hangIndent`, `taskState`, `fenceChar`, `fenceLen`, `hardBreak`.

Stateful pieces of `classify`:

- A fence state machine tracks open `` ``` ``/`~~~` blocks; lines inside a fence are tagged `in-fence` until a matching closer (same char, length ≥ opener).
- Three post-passes run on the assembled records: `applySetextPass` (retags `prose + ---` pairs as `heading-setext`), `applyTablePass` (retags pipe-table runs as `table-row`), `applyHardBreakPass` (sets `hardBreak` on `prose`/`list-item` lines ending in 2+ spaces or `\`).

### Pipeline contract

`readContent(source)` reads selection or clipboard, falls back to the other if empty. `guardSize` rejects inputs over `MAX_INPUT = 1_000_000` bytes. `deliver` either pastes/copies/HUDs OR — when `launchContext.callbackLaunchOptions` is present — short-circuits to a cross-extension callback (LitoMore convention, implemented via the built-in `launchCommand`).

`failureToast(title, message)` is the project's standard error toast. It always includes a "Copy Error" `primaryAction` that copies `${title}: ${message}` to the clipboard. **Every error path must use this helper or include the same `primaryAction` shape inline** — see "Hard rules" below.

## Hard rules

1. **Never hand-write `Preferences` or `Arguments` types.** Raycast auto-generates `Preferences.WrapText`, `Preferences.UnwrapText`, `Arguments.WrapText`, `Arguments.UnwrapText` to `raycast-env.d.ts` from `package.json`. Use the generated types directly.
2. **No `any` casting.** The narrow casts `as " " | "x" | "X"` (on `taskMatch[0][1]`) and `` as "`" | "~" `` (on `run[0]` from `FENCE_BOUNDARY`) are sanctioned because the regex guarantees the value. Anywhere else, use `unknown` + narrowing or generics.
3. **Every failure toast must include a "Copy Error" `primaryAction`.** Use `failureToast` from `pipeline.ts` or replicate the shape inline. This applies to expected and unexpected failures.
4. **Run `npx ray lint --fix` before every commit.** It formats code AND markdown.
5. **TDD for pure functions.** The classifier, wrap, unwrap, and inline modules have failing tests written first. Don't weaken tests to make them pass.

## Tech stack notes

- TypeScript strict, `target: ES2023`, `module: commonjs`, `jsx: react-jsx`.
- `raycast-env.d.ts` is git-ignored and regenerated by `ray` — never hand-edit or commit it.
- ESLint flat config at `eslint.config.mjs` (not `.js`/`.eslintrc`). Stays on ESLint 9 because `@raycast/eslint-config` does not yet target 10.
- The `ajv` audit warning is in Raycast's dependency tree and cannot be fixed locally.
- Platform: macOS only (`platforms: ["macOS"]` in `package.json`).
- Adding a new command requires both a file under `src/` AND a matching entry in `package.json` `commands[]` (the `name` must match the filename without extension).
