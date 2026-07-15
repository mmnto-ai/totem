---
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/cli': patch
---

docs(claim-discipline): strategy#531 seam-repair burn-down — package-family description alignment + public-surface register fixes (mmnto-ai/totem#1950 residual class).

The published package family disagreed with itself: `@mmnto/cli` carries the ruled D1 self-description (mmnto-ai/totem#2336 / mmnto-ai/totem#2349) while `@mmnto/totem` and `@mmnto/mcp` still advertised the retired "persistent memory and context layer" category. Public docs also carried autonomy framing ahead of the mechanism ("automatically heal itself", "takes autonomous action", "no extra setup").

- `@mmnto/totem` + `@mmnto/mcp` `package.json` descriptions and per-package READMEs re-cut on the D1 descriptive core; drift-locked by per-package parity tests mirroring the CLI's (`description.test.ts` in each package).
- README + wiki register fixes: canonical plain-file sources vs derived LanceDB index no longer conflated; the IDE-level MCP registration step is named instead of "no extra setup"; `totem spec`'s catch claim is first-person, not a product guarantee; `totem doctor --pr` copy states the real mechanism — telemetry-derived downgrades staged as a PR a human merges — replacing "Self-Healing"/"autonomous" framing; "provides the hard guarantee" residual (mmnto-ai/totem#1950 class) reworded to the mechanical claim.

Consumer-impact: npm registry metadata (`description` fields) and rendered README/docs pages only; no runtime code paths change (the two new files are tests).
