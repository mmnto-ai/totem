---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

fix(smoke-gate): `runSmokeGate` evaluates § Design 8 `requires:` with the runtime's own evaluator, so a `requires:`-bearing record's `good` example goes silent for the right reason and `totem rule test` / the cert-path preimage differential can pass such records (mmnto-ai/totem#2678).

The record grammar admits `requires: { pattern, scope }` (Prop 310 § Design 8 — the rule fires at a target match iff the required context is ABSENT within the declared scope), the lowering carries it onto `CompiledRule.requires`, and the runtime dispatchers evaluate it through `requiresSuppressesMatch`. Only the compile-time smoke gate ran pass one. Because a § Design 8 record's `good` example keeps the target and adds the companion, the gate reported it as over-matching and no such record could pass. The gate now calls the same `requiresSuppressesMatch` the runtime calls — one evaluator rather than a second implementation — on both the regex and the ast-grep path.

It also takes that evaluator's preconditions with it: every rule goes through `assertNoTornRecordRules`, and a `requires:`-bearing one adds `assertRequiresPatternsSafe` and `assertNoAstGrepLineScope`, before it is evaluated — two of these at each regex dispatcher, all three at the ast dispatcher. Without them the gate accepted rules the runtime refuses — a torn rule carrying a Prop 310 compiled home with no `examples`, an unsafe-but-compilable `requires.pattern` that backtracks catastrophically under `totem rule test`, and `ast-grep` paired with `requires.scope: line`. A failed precondition is reported as a gate reason rather than propagated as a throw. The frozen legacy corpus is untouched by construction: the torn check early-returns for a rule carrying no compiled home, and no legacy rule carries one.
