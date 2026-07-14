---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

fix(config): `indexIgnorePatterns` — index-only exclusions split from lint/shield scope, plus loud disclosure when `ignorePatterns` drops files from a review diff (mmnto-ai/totem#1748, upstream-feedback/046).

`config.ignorePatterns` is documented as index exclusion but was also silently merged into the lint/shield diff filter — an operator excluding paths from _indexing_ (e.g. `audits/**`, "keep on disk, out of the semantic index") silently disabled _lint_ on those paths (two live exhibits, including a staged lint that dropped audit files with no trace). Conservative composite, no behavior break:

- New `indexIgnorePatterns` config key (core schema): excluded ONLY from indexing, never from lint/shield scope. Moving index-intent patterns here restores lint coverage immediately.
- `ignorePatterns` keeps its dual scope for back-compat; its docstring now states the dual scope honestly. The full inheritance split (lint stops consuming `ignorePatterns`) is registered for 2.0.0 in mmnto-ai/totem#1746.
- Tenet-4 floor at the diff boundary: every review/lint diff derivation now discloses `Filtered N file(s) from the diff per ignorePatterns/shieldIgnorePatterns: ...`, naming each dropped file (capped at 8 + overflow count), so un-migrated configs stop failing silently.

Consumer-impact: config schema (additive key, no migration required) + lint/shield/review terminal output (new warning line whenever ignore patterns drop files from the derived diff; verdicts, exit codes, and diff contents are byte-identical for runs where the patterns drop nothing).
