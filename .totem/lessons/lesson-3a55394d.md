## Lesson — Pinned evidence is not edited at the pin; hardening goes to a versioned follow-up

**Tags:** migration, testing, governance
**Scope:** operations-local/gate5/**/*.mjs

A verification script committed beside its recorded output is evidence: editing it after the pin leaves the committed log no longer the output of the committed script, and a further commit moves a pin that was mailed by SHA. A reviewer's hardening ask on such a script is measured first (is the premise true, is the committed run sound, does a replay reproduce the log byte for byte) and then deferred to a tracked follow-up rather than folded in place (mmnto-ai/totem#2948, the inertness replay script; tracked on mmnto-ai/totem#2952).
