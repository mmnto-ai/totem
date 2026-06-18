---
'@mmnto/totem': minor
'@mmnto/cli': patch
---

Ratify wind-tunnel scorer verdict semantics (mmnto-ai/totem#2189, post-#2188 deferral item 3) per strategy-claude's 2026-06-17 verdict-semantics ruling (refines ADR-110 §4/§5):

- **FAIL outranks the masquerade guards.** `scoreWindtunnel` now evaluates the FAIL tier (confirmed-FP, vacuous positive control) before the exposure-floor and cull-rate guards. A confirmed FP under a thin exposure no longer masquerades as HONEST-NEGATIVE — the guards may only demote a would-be PASS, never upgrade a FAIL.
- **`WindtunnelVerdict.precision` is now `number | null`.** A real value only on verdicts that make a precision claim (PASS = 1.0; confirmed-FP FAIL = the breaching value, which is the evidence); `null` (not-computed) on every no-claim verdict (exposure-floor / cull-rate / needs-adjudication HONEST-NEGATIVE, and vacuous-control FAIL). This migrates the prior `precision: 0` placeholder — `0` is now reserved for a real all-FP measurement and never means "not computed".
- **New `WindtunnelVerdict.diagnostics.survivorPrecision`** carries the informative TP/(TP+FP)-over-survivors ratio, separately namespaced from the certifying `precision` and never part of the gate decision.

CLI `totem spine windtunnel run` output now prints the null-guarded certifying `precision` plus a `survivorPrecision` diagnostic line.
