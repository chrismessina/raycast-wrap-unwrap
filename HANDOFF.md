# Handoff — wrap-unwrap (2026-07-25)

**State: shippable pending the `raycast-extensions:ship` flow.** Everything below is
committed and signed on LOCAL `main` only — nothing is pushed.

## Current state (verified 2026-07-25)

- **Branch:** `main`, ahead of `origin/main` by **5** commits.
- **Remote:** `origin` = `github.com/chrismessina/raycast-wrap-unwrap`.
- **Published:** yes, upstream at `raycast/extensions/extensions/wrap-unwrap`.
- **Gates:** `npm test` → 137/137 · `npx tsc --noEmit` → exit 0 · `npx ray lint` → exit 0.
- **Working tree:** clean except `package-lock.json` (pre-existing dep drift, see below),
  untracked `.github/`, and this file.

### Commits ahead of origin (newest first)

```text
e97d490 fix(reflow): correct 24 wrap/unwrap defects and three quadratic paths  ← this session
aea831a chore: sort imports via @ianvs/prettier-plugin-sort-imports
96511f2 style: reformat to printWidth 120 to match .prettierrc
c7ad7e6 fix(unwrap): rejoin hyphen-broken words with no space
c7aac7b chore: add .prettierrc matching fleet standard
```

## What this session did

Started as "fix the `pipeline.ts` House Style nit + run the audit." The audit came back
clean, but the requested Codex review escalated into **five rounds of adversarial review
plus fuzzing, finding 24 real defects** — all reproduced with concrete inputs before
being fixed, all fixed, all covered by tests.

**The two that actually mattered:**

1. **Three quadratic paths.** A paste within the supported 1MB limit could hang Raycast
   for minutes with no feedback. 188KB of indented code went 10,299ms → 14ms; an 833KB
   single paragraph 18,031ms → 21ms. Causes: a per-line rescan of all prior records in
   `classify`, an anchored regex tested against the whole accumulated paragraph, and a
   `slice()` on that accumulator forcing V8 to flatten the rope on every join.
2. **`well-` + `known` → `wellknown`** with Strip Soft Hyphens on — the exact case
   `c7ad7e6` was written to fix — and `test/unwrap.test.ts` was *asserting* the corrupted
   output, which is why 102/102 was green.

### The hyphenation policy (decided by Chris, 2026-07-25)

Only a **true U+00AD soft hyphen** is ever stripped. An ASCII `-` at a line break is
regex-indistinguishable from a real compound, so it is **always preserved** and the two
halves join **tight**. Consequences, all intentional:

- `well-` + `known` → `well-known` ✓
- `state-of-the-` + `art` → `state-of-the-art` ✓
- `inter-` + `esting` → `inter-esting` (NOT `interesting` — the deliberate trade)
- `5-` + `10` → `5-10` ✓
- `hy` + U+00AD + `phen` → `hyphen` (ON) / `hy­phen` (OFF)

The **preference description and README were rewritten** because both promised
`inter-` + `esting` → `interesting`, which would have shipped a false claim to every
user in Raycast's settings UI.

## Do BEFORE / DURING the Store PR

1. **`package-lock.json`** — 846 lines of transitive drift from an earlier `npm install`;
   `package.json` is untouched, so it is pure caret-range resolution. **Predates this
   session**, deliberately left unstaged and uncommitted. This is `ship`'s dep-hygiene
   call, not a code change.
2. **Untracked `.github/`** holds a `sync-from-upstream.yml` mirror workflow. Chris's
   call (2026-07-25): **leave it for `ship` to handle.** It must NOT reach the Store PR.
   Mirror topology + "what ships" allow-list:
   `/Users/messina/Developer/GitHub/chrismessina/raycast-extension-workflows/plugins/raycast-extensions/reference/my-extensions-mirror.md`
3. **CHANGELOG is written and complete** — 21 bullets, exactly one `{PR_MERGE_DATE}`
   placeholder, no hand-invented date. Do not add a real date; Raycast substitutes it.
4. **House Style audit was re-run on the final diff and is clean** — but `ship` re-runs it
   as the gate, which is correct. Note this extension is `mode: "no-view"` ×2, so the
   keyboard-shortcut and Copy-Error-toast rules are N/A / already satisfied via
   `failureToast()`; and it makes zero web requests, so `@chrismessina/raycast-logger`
   correctly does not apply.
5. **Do NOT reintroduce the old dash-deletion behavior** — superseded by the maintainer
   upstream (see file-memory `wrap-unwrap-publish-flow`).

## Test suite notes for whoever comes next

102 → **137 tests**. Two fuzz harnesses were added as permanent regression guards:

- **List-shape round trip:** 10,080 combinations (7 indents × 10 markers × 3 gaps ×
  4 task states × 4 quote forms × 3 widths). This is what caught the `>`-no-space
  round-trip bug that four review rounds had missed.
- **Inline-state consistency:** 21,632 probes checking that no join loses or fabricates
  characters.
- Plus an explicit **perf guard** asserting a 20k-line paragraph unwraps in <400ms. If
  someone reintroduces a rope-flattening `slice()` or a full-accumulator regex, that test
  fails instead of the extension silently hanging in the field.

**Three tests were changed to assert *different* behavior** (not merely extended), each
because it encoded a bug: the `wellknown` mash, the `5- 10` space, and a tab-indented
continuation that visually overran its column. If you are diffing tests and wondering
why an assertion flipped, that is why.

## Reference

- House Style checklist: `/Users/messina/Developer/GitHub/chrismessina/raycast-extension-workflows/plugins/raycast-extensions/reference/house-style.md`
- Mirror topology / allow-list: `…/reference/my-extensions-mirror.md`
- Ship mechanics: the `raycast-extensions:ship` skill.
