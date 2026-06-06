---
'@mmnto/cli': patch
---

feat(cli): `totem lint`/`totem review` gain `--branch` and `--base <ref>` to force the push-gate (branch-vs-base) diff scope regardless of working-tree state (#2091); conflicting scope selectors (`--staged`, `--diff`) hard-error instead of silently winning. `totem lint` additionally warns when its auto-selected `uncommitted`/`staged` scope is narrower than what the pre-push gate will check, with the exact file-count gap (#2090). Both close the local-PASS-hides-gate-failures trap (#2055).
