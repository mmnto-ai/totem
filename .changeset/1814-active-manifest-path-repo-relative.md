---
'@mmnto/cli': patch
---

Compute Stage 4 manifest exclusion path against `repoRoot`, not `config.totemDir`.

Follow-up to PR #1812 (closes #1796) catching GCA HIGH on the auto-VP PR #1814. The `activeManifestPath` exclusion key in `compile.ts` is compared against `git ls-files` output, which is repo-root-relative. Joining `config.totemDir` alone produced the wrong key when `cwd != configRoot != repoRoot` (monorepo subpackage invocation): the exclusion failed to match the repo-relative `git ls-files` line, so `compiled-rules.json` slipped into the Stage 4 scan corpus and self-matched against rules' own `badExample` text.

Resolution: defer the `activeManifestPath` computation into the verifier closure (after `repoRoot` is resolved) and use `path.relative(repoRoot, path.join(totemDir, 'compiled-rules.json'))`. Mirrors the canonical pattern at `first-lint-promote-runner.ts:99`. Pre-existing tech debt tracked in MEMORY.md from claude-0014; PR #1796's surgical scope (lessons / rules / fixtures resolution) didn't touch it. GCA's review on the VP PR was the natural moment to close it.
