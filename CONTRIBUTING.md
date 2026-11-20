# Contributing to Wrap Unwrap

Thanks for helping. This guide covers running Wrap Unwrap locally and sending a change.

## Where changes go

Wrap Unwrap is published in the [Raycast Store](https://www.raycast.com/chrismessina/wrap-unwrap).
Open pull requests against [`raycast/extensions`](https://github.com/raycast/extensions/tree/main/extensions/wrap-unwrap),
not this repository: Raycast reviews every change there, and merged changes sync back here
automatically. Open [issues](https://github.com/chrismessina/raycast-wrap-unwrap/issues) here or in
`raycast/extensions`, whichever you prefer.

## Run it locally

You need [Raycast](https://www.raycast.com/) and Node.js 22 or later.

1. In Raycast, find Wrap Unwrap in the Store and choose **Fork Extension** from the action panel.
   Raycast checks out only this extension's folder from `raycast/extensions`.
2. In that folder, run `npm ci`, then `npm run dev`. Raycast opens the development version, and
   saving a file reloads it.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the extension in Raycast and reload on save |
| `npm run build` | Build the distribution bundle |
| `npm run lint` | Run Raycast's ESLint and Prettier checks |
| `npm run fix-lint` | Fix what the linter can fix |
| `npm test` | Run the `node:test` suites in `test/` through `tsx` |

## How it works

```
src/
├── wrap-text.ts       # Wrap Text command entry point
├── unwrap-text.ts     # Unwrap Text command entry point
└── lib/
    ├── classify.ts    # Line → blockquote prefix stack + inner role
    ├── wrap.ts        # Greedy fill with block-safe break rejection
    ├── unwrap.ts      # Group joining, hyphenation, bullet flattening
    ├── inline.ts      # Placeholder protection for atomic inline tokens
    ├── regex.ts       # Shared block and inline patterns
    └── pipeline.ts    # Input, size guard, delivery, failure toasts
test/                  # node:test suites
test-fixtures/         # 14 Markdown fixtures covering each block role
assets/                # Extension icon (runtime)
media/                 # README images
```

Both commands are `no-view`. Each entry point reads its preferences and any `launchContext`, uses
`src/lib/pipeline.ts` to read the selection or clipboard and refuse oversized input, runs its
transform, and hands the result back to `pipeline.ts` to paste, copy, or send to a callback
command. The transforms
classify every line (`classify.ts`), reflow only prose and list items (`wrap.ts`, `unwrap.ts`),
and re-emit every other line byte-for-byte. The README's "How Reflow Works" section describes the
rules, and `CONCEPTS.md` defines the terms (Classified Line, Role, Quote Frame, Reflow Group).

## Before you open a pull request

- `npm run build`, `npx tsc --noEmit`, `npm run lint` and `npm test` all pass.
- You tried the change in Raycast, including its error and empty states.
- `CHANGELOG.md` has a new entry at the top, dated `{PR_MERGE_DATE}`. Raycast fills in the date
  when the pull request merges.
- New or changed screenshots go in `metadata/`, taken with Raycast's Window Capture.
