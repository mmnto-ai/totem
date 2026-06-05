---
'@mmnto/cli': patch
---

`totem doctor --strict` now exercises the parity sensor when a repo-local `orient.parityManifest` is configured — closing the "green-by-not-checking" gap where consumer CI (which runs `--strict`, not `--parity --strict`) never ran the drift check (mmnto-ai/totem-strategy#545 Half 2).

Zero churn for non-adopters: a repo that hasn't configured a manifest sees byte-identical `--strict` output (the fold is a no-op until you opt in). Per ADR-109 / Tenet 13 the throw-gate stays at the CLI edge, and the standalone `doctor --parity` is unchanged.
