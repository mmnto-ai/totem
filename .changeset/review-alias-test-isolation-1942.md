---
'@mmnto/cli': patch
---

fix(cli): isolate `review-alias.test.ts` spawn cwd from the real repo (mmnto-ai/totem#1942)

Closes [mmnto-ai/totem#1942](https://github.com/mmnto-ai/totem/issues/1942).

The `shield alias emits deprecation warning` test previously spawned `node dist/index.js shield` with `cwd: process.cwd()` — a path inside the real repo. The spawned process ran `shieldCommand`, which silently calls `upgradePrePushHookIfNeeded(process.cwd())`; that resolved the real git root and rewrote the developer's `.git/hooks/pre-push` from the legacy format to the stateless format mid-test. When `git push` was the calling context (the legacy pre-push hook runs `pnpm run test`, which forked the offending test), bash reported a syntax error against a line whose content matched a different line — the canonical mid-parse-rewrite tell.

The spawn now uses a fresh `os.mkdtempSync` directory under `os.tmpdir()` as its cwd, so `resolveGitRoot` returns `null` and the upgrader short-circuits before writing.

A new vitest `globalSetup` (`packages/cli/vitest.global-setup.ts`) snapshots `.git/hooks/pre-push` at run start and asserts byte-identity at teardown — a future test that introduces the same isolation defect fails with surface-area and remediation guidance inline. The check is coarse (one snapshot per run, not per test) and cheap.

Production behavior of `upgradePrePushHookIfNeeded` is unchanged. The 11 additional test files that the original investigation comment flagged as mutators were cross-worker contamination artifacts — parallel workers snapshotted the pre-mutation hash in `beforeEach`, then observed the post-mutation hash in `afterEach` because `review-alias.test.ts` had written to the shared real file mid-run. Running each in isolation against the legacy-format hook confirmed only `review-alias.test.ts` writes.
