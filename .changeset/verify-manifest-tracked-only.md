---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

fix(verify-manifest): hash git-tracked lessons only, so an untracked scratch lesson can't block an unrelated push (mmnto-ai/totem#2051 / mmnto-ai/totem#2055).

`generateInputHash` walked every `.md` under `.totem/lessons/` including untracked files, so a single MCP `add_lesson`/`extract` scratch lesson diverged the compile-manifest input hash and tripped the pre-push `verify-manifest` gate (plus `lint`/`status` staleness) on changes that never touched lessons — the working-tree-scope class of mmnto-ai/totem#2051.

It now takes an optional repo cwd and, inside a git repo, hashes only git-tracked lessons; untracked working-tree scratch is excluded. `verify-manifest`, `lint`, and `status` pass the cwd. The producer (`totem compile`) runs on a clean tree, so the recorded hash already equals the tracked-only hash — no recompile is forced, and consumer manifests with no untracked lessons are unaffected. Outside a git repo, or on any git error, it falls back to the prior all-files walk (a new `listTrackedFilesUnder` core helper resolves the tracked set, NUL-delimited and cross-platform). Part of the gate-correctness cluster (mmnto-ai/totem#2055).
