---
'@mmnto/totem': patch
'@mmnto/cli': minor
---

feat(autoclose): `totem pr merge` — sanctioned auto-close-safe squash-merge actuator (mmnto-ai/totem#1762, B slice)

- **cli**: `totem pr merge [number]` asserts the repo merge-config posture via
  GraphQL (reusing core's `evaluateMergeConfigPosture`), refuses undeclared
  close-keyword refs in the PR title/body (a `totem-close` marker is the sole
  authorizing channel), accepts only a positive-decimal PR number, binds
  `--repo` to both lookup and merge, pins the evaluated snapshot with
  `--match-head-commit`, treats a merge-queue landing as unsettled (declared
  closes deferred until MERGED), and merges squash-only with no body/subject
  flags, ever. `--check-only` evaluates without merging; `--close-declared`
  opt-in executes the marker-declared closes (the default prints the exact
  commands; a failed declared close exits non-zero with a summary).
- **core**: new `PR_MERGE_FAILED` TotemError code.

The A-slice command-interception layer (a raw `gh pr merge` shell interlock)
was built, review-hardened across five rounds, and then stripped per the
operator's OPTION 1 ruling (2026-07-22): server-side repo config (squash-only +
BLANK squash body) plus the D1 required check and the D2 post-merge sensor
already cover the accidental-close vectors, so client-side shell parsing sat at
the wrong altitude. The A history remains in the PR's pre-strip commits.

Changelog-reader note: examples use digitless placeholder shapes such as a
`Closes #NNN` form only.
