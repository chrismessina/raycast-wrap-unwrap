# Handoff — wrap-unwrap (2026-07-25)

**State: pre-flight complete and PUSHED to the mirror. One step remains — the Store PR,
which is blocked on `gh` auth only.** See `.github/docs/RESUME-SHIP.md` for the exact
commands; the fork-sync recipe there has been dry-run and validated.

## Current state (verified 2026-07-25)

- **Branch:** `main` == `origin/main` == **`9ed10d5`**, 0 unpushed. Mirror is current.
- **Remote:** `origin` = `github.com/chrismessina/raycast-wrap-unwrap`.
- **Published:** yes, upstream at `raycast/extensions/extensions/wrap-unwrap`.
- **Gates:** `npm test` → **147/147** · `npx tsc --noEmit` → 0 · `npx ray lint` → 0 ·
  `npx ray build` → 0.
- **Working tree:** clean except `package-lock.json` (pre-existing dep drift) and
  untracked `.github/`.

## THE ONE BLOCKER: `gh` auth

Every `gh` call — including `gh auth status` and `gh config list`, which touch no network —
returns `authorization timeout`. `~/.config/gh/hosts.yml` has no readable token and
`credential.helper = manager`, so `gh` is waiting on a 1Password prompt nobody was there to
approve. **SSH git works** (commit signing and the mirror push both succeeded) because that
is the SSH agent, a different path. Unlock 1Password and `gh auth status` should return.

### Commits from this session (newest first)

```text
9ed10d5 chore: adopt the maintainer's upstream test-fixture edits
d230a43 fix(wrap): judge the resulting LINE, not the next token
6c24dd2 test: guard the list-nested blockquote boundary cases
01f4fa6 fix(classify): require real list-item indentation to mark a nested quote
7357f68 fix(wrap): probe the bare token too, catching HR round-trip breakage
5f5ef12 fix(wrap): close three defects found by a fifth review round
48d2568 docs: update handoff for the reflow-correctness work
e97d490 fix(reflow): correct 24 wrap/unwrap defects and three quadratic paths
```

Plus the four pre-session commits (`aea831a` import-sort, `96511f2` printWidth reformat,
`c7ad7e6` hyphen fix, `c7aac7b` .prettierrc).

## What this session did

Started as "fix the `pipeline.ts` House Style nit + run the audit." The audit came back
clean, but the requested Codex review escalated into **seven rounds of adversarial review
plus property fuzzing, finding 30 real defects** — all reproduced with concrete inputs
before being fixed, all fixed, all covered by tests. Rounds 5, 6 and 7 each found bugs in
the *fixes* from the round before, including two I introduced myself; round 7's first fix
attempt reintroduced a quadratic path (1MB → 32s) that my own perf guard caught.

**The two that actually mattered:**

1. **Four quadratic paths.** A paste within the supported 1MB limit could hang Raycast
   for minutes with no feedback. 188KB of indented code went 10,299ms → 14ms; an 833KB
   single paragraph 18,031ms → 22ms; 1MB of prose 32,056ms → 39ms. Causes: a per-line
   rescan of all prior records in `classify`, an anchored regex tested against the whole
   accumulated paragraph, a `slice()` on that accumulator forcing V8 to flatten the rope
   on every join, and (introduced then removed in round 7) a per-break scan of all
   remaining tokens.
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

102 → **147 tests**. Three property harnesses were added as permanent regression guards:

- **List-shape round trip:** 10,080 combinations (7 indents × 10 markers × 3 gaps ×
  4 task states × 4 quote forms × 3 widths). This is what caught the `>`-no-space
  round-trip bug that four review rounds had missed.
- **Inline-state consistency:** 21,632 probes checking that no join loses or fabricates
  characters.
- **Trailing-construct round trip:** every construct shape the classifier recognizes, as a
  final token (62/62). This caught the bare-`***` horizontal rule that the earlier
  per-token probe masked.
- Plus explicit **perf guards** on both `wrap` and `unwrap`. These have already earned
  their place twice: they caught a rope-flattening `slice()` and, in round 7, a
  per-break token scan that took 1MB to 32s. Without them the extension would have
  silently hung in the field instead of failing a test.

**Three tests were changed to assert *different* behavior** (not merely extended), each
because it encoded a bug: the `wellknown` mash, the `5- 10` space, and a tab-indented
continuation that visually overran its column. If you are diffing tests and wondering
why an assertion flipped, that is why.

## Reference

- House Style checklist: `/Users/messina/Developer/GitHub/chrismessina/raycast-extension-workflows/plugins/raycast-extensions/reference/house-style.md`
- Mirror topology / allow-list: `…/reference/my-extensions-mirror.md`
- Ship mechanics: the `raycast-extensions:ship` skill.
