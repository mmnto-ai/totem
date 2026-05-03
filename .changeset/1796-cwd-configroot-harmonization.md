---
'@mmnto/cli': patch
---

Resolve `.totem/` against `configRoot` instead of `cwd` in `compile` and `test-rules`.

Closes mmnto-ai/totem#1796. Both commands already compute `configRoot = path.dirname(configPath)` at the top of the function (added in PR #1795 for `bootstrapEngine`), but the downstream `path.join(cwd, config.totemDir)` calls still used `cwd`. In monorepo subpackage invocations where `cwd != configRoot`, that resolved `.totem/` to the wrong directory — pack/manifest state was read from the configRoot, but lessons, compiled rules, and test fixtures were read from the subpackage's cwd.

Mirrors the configRoot-relative pattern already established in `run-compiled-rules.ts:107` and `first-lint-promote-runner.ts:45`. New regression test (`path-harmonization.test.ts`) chdirs into a nested subpackage and asserts both commands invoke their downstream consumers with configRoot-relative paths.
