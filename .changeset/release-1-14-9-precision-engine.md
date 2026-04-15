---
'@mmnto/totem': patch
---

Precision Engine: compound ast-grep rules + compile-time smoke gate

The 1.14.9 release closes the rule-quality loop before Pack Distribution opens. Compiled rules can now express structural context ("inside a loop", "outside an import"), and every Pipeline 2 / Pipeline 3 rule must demonstrably match its own `badExample` snippet before it lands in `compiled-rules.json`. Defense-in-Depth Layer 2: the schema rejects malformed shapes at parse time; the smoke gate rejects semantically-broken rules at compile time.

**Compound ast-grep rules (#1410, #1412):**

- New `astGrepYamlRule` field on `CompiledRule` carries full `NapiConfig`-shape compound rules with `inside`, `has`, and `not` combinators. Mutually exclusive with the flat `astGrepPattern` field via Zod `superRefine`.
- New `canonicalStringify` utility in `compile-manifest.ts` produces key-order-deterministic hashes so compound rules with semantically-identical shapes but different LLM key orders cannot trip `verify-manifest`. Backward-compat guard: pre-1.14.9 manifests without compound rules hash byte-for-byte to the same value as before, so existing installs do not need a forced recompile.
- Spike harness committed under `packages/core/spikes/compound-ast-grep/` with 9 tests pinning the empirically-validated behaviors of `@ast-grep/napi@0.42.0`, including the sharp edge that `inside: { pattern: 'for ($A; $B; $C) { $$$ }' }` silently matches zero (use `inside: { kind: 'for_statement' }` instead).

**Engine runtime + compile-time smoke gate (#1415):**

- `applyAstRulesToAdditions` widened to dispatch on either `astGrepPattern` (string) or `astGrepYamlRule` (object), with per-rule try/catch in `executeQuery` so one malformed rule cannot crash a whole file's lint pass.
- New `'failure'` event variant on `RuleEventCallback`, semantically distinct from `'suppress'` (suppression is reserved for user-initiated `totem-ignore` directives). Failure context carries `failureReason` for `totem doctor` aggregation.
- New `compile-smoke-gate.ts` module exports `runSmokeGate(rule, badExample)`. Reuses the runtime engine entry points (`matchAstGrepPattern`, `new RegExp`) so a rule passing the gate cannot silently fail to match at runtime on identical input. Multi-extension iteration so rules scoped to both `.js` and `.jsx` (which map to different parsers) match under whichever parser the snippet needs.

**Compiler prompt + `badExample` requirement (#1420):**

- Pipeline 2 and Pipeline 3 compiler prompts rewritten to teach Sonnet compound rule emission with `kind:` for outer combinator targets. Three compound examples (inside-a-for-loop, has-shell-true, JSON.parse-not-in-try) each carrying their own `badExample`.
- New `KIND_ALLOW_LIST` named export from `compile-templates.ts`. 15 tree-sitter kinds covering common outer-combinator surfaces (control flow, function and class declarations, imports/exports, if/switch). Reusable: `totem doctor` will lint existing compiled rules for illegal `kind:` targets in a future release.
- `CompilerOutputSchema.badExample` flipped from optional to required for `ast-grep` AND `regex` engines via `superRefine`. The `ast` (Tree-sitter) engine stays exempt because the smoke gate does not yet cover S-expression queries. Pipeline 1 (manual) gate enforcement is deferred to #1414 pending a 136-lesson Bad Example backfill.

**Architectural impact:**

Pipeline 2 compile throughput dropped to near zero between #1415 and #1420 because the gate started rejecting rules before the prompt had taught Sonnet to emit `badExample`. This was the gate working as designed: better zero rules than zero-match hallucinations distributed via packs. The prompt rewrite in #1420 reopens the throughput valve. Phase 4 of the epic (batch-recompile of 22+ archived rules tagged `upgradeTarget: compound`) unblocks once the new prompt is exercised against the queue.

**Test counts:** 2879 passing across core (1134), CLI (1662), MCP (83). Net +93 from the 1.14.8 baseline of 2786.

**Compiled rules:** 411 in the rules array (389 active, 22 archived). 889 nonCompilable entries in the sibling ledger (lessons the LLM declined to convert into rules).

**Follow-ups (unmilestoned):** #1414 (Pipeline 1 backfill), #1418 (MCP stale-handle), #1419 (Trap Ledger crypto attestation for SOX). The pre-1.15.0 deep review gate (#1421) blocks 1.15.0 implementation until a four-surface independent pass on `main` clears.
