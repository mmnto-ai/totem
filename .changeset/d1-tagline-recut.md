---
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/cli': patch
---

chore(descriptions): D1 tagline re-cut, family-wide — the mmnto-ai/totem-strategy#531 A1 tagline convergence (blind-gate release comment 4979503772 + operator veto-edit 2026-07-15) supersedes the Prop 294 D1 headline across the published package family.

New ruled core: "local-first toolkit that keeps AI-agent work queryable, enforceable, and derivable as plain files in your codebase". Retires "substrate" from public copy (plain-words ruling) and the em-dash (veto-edit) on every npm-visible description surface: the CLI's single-sourced constant (`--help` header + `@mmnto/cli` package.json), `@mmnto/totem` + `@mmnto/mcp` package.json descriptions, and all three per-package README ledes. Parity tests re-pin the new core and add substrate/em-dash regression guards.

Consumer-impact: npm registry metadata and rendered README pages only; no runtime code paths change.
