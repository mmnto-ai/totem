---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

ADR-088 Phase 1 Layers 3 and 4 substrate: unverified flag and reason codes.

`CompiledRule` gains an optional `unverified: boolean` field, set to `true`
when the rule was compiled from a lesson lacking a non-empty Example Hit
block. Pipeline 1 (manual), Pipeline 2 (LLM), and Pipeline 3 (example-based)
all flag the rule rather than shipping a pattern with no ground truth.
Security-scoped lessons (`deps.securityContext === true` or a manual rule
with `immutable: true`) reject outright instead of flagging, per the
Decision 3 zero-tolerance policy. Absence of the field preserves pre-#1480
manifest hashes via `canonicalStringify`; the literal `false` is never
written.

The `nonCompilable` ledger upgrades from `{hash, title}` to the 4-tuple
`{hash, title, reasonCode, reason?}`. `reasonCode` is one of
`no-pattern-generated`, `pattern-syntax-invalid`, `pattern-zero-match`,
`verify-retry-exhausted`, `security-rule-rejected`, `no-pattern-found`,
`out-of-scope`, `missing-badexample`, or `legacy-unknown`. The loader
accepts all three historical shapes (string, 2-tuple, 4-tuple) and
normalizes legacy rows to `reasonCode: 'legacy-unknown'`; the writer
enforces the 4-tuple via a strict `NonCompilableEntryWriteSchema`.
`saveCompiledRulesFile` validates every entry before serialization and
throws on schema mismatch, following the lesson 400fed87 Read/Write
invariant.

Pipeline 2 validator rejections (invalid regex, unparseable ast-grep) and
LLM-response parse failures move from the `failed` bucket to `skipped`
with an explicit reasonCode so ADR-088 Layer 4 telemetry sees every
outcome. `compile.ts` `nonCompilableMap` now carries the full 4-tuple
through the run, and `install.ts` pack-merge routes writes through
`saveCompiledRulesFile` so pack installs also go through the Write
schema gate.

Closes #1480. Closes #1481.
