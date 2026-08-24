---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

fix(smoke-gate): `runSmokeGate` evaluates § Design 8 `requires:` with the runtime's own evaluator, so a `requires:`-bearing record's `good` example goes silent for the right reason and `totem rule test` / the cert-path preimage differential can pass such records (mmnto-ai/totem#2678).

The record grammar admits `requires: { pattern, scope }` (Prop 310 § Design 8 — the rule fires at a target match iff the required context is ABSENT within the declared scope), the lowering carries it onto `CompiledRule.requires`, and every runtime dispatcher evaluates it through `requiresSuppressesMatch`. Only the compile-time smoke gate ran pass one. Because a § Design 8 record's `good` example keeps the target and adds the companion, the gate reported it as over-matching and no such record could pass. The gate now calls the same `requiresSuppressesMatch` the runtime calls — one evaluator, never a second implementation — on both the regex and the ast-grep path, and reports an uncompilable `requires.pattern` as a gate reason rather than propagating the throw. Rules without a `requires` block are untouched by construction: every call site is guarded on its presence.
