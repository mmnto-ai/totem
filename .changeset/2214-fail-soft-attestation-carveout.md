---
'@mmnto/totem': patch
---

lint: recognize the Tenet-4 shape-2 fail-soft attestation (#2214 acceptance-#3, lockstep with strategy#702/#708).

A blanket fail-soft `catch` at a declared IO/LLM/network boundary is licensed by Tenet 4 only when it names a loud systemic backstop. Previously authors escaped `lesson-fail-open-catch-ban` either with a free-text `// totem-context:` (indistinguishable from a rationalized swallow) or by rewriting the `catch` as `.catch(() => …)` — a `call_expression` the rule never matches, strictly worse for the corpus. The carve-out makes that legitimacy **recognized, not dodged**.

- **`parseFailSoftAttestation`** recognizes the structured `// totem-context: fail-soft backstop=<name>` directive and surfaces a typed `{ kind: 'fail-soft', backstop }` exemption on the `'suppress'` rule-event (auditable; couples to the #697 Layer-B capability ledger). Recognition is narrow — only a **leading** `fail-soft` token is an attestation, so existing prose escapes ("best-effort cleanup, fail-soft") are unaffected (additive, non-breaking).
- A `fail-soft` claim that names **no** backstop always surfaces a **non-blocking WARN** (`totem/fail-soft-missing-backstop`) on both the ast-grep and tree-sitter suppression paths — so the grammar can't go decorative (a swallow banked without paying the structural cost of a named backstop is the exact Tenet-4 drift). It is **WARN, never ERROR**: the lint establishes token-presence only; the backstop's loudness + per-item accounting are verified at review/ADR level (Tenet 13/19), so blocking is the consumer's actuator and an error would overclaim.
- Shape 1 (type-discriminated rethrow, `if (!(err instanceof X)) throw err; return soft`) already passes the matcher — locked with a regression fixture, no matcher change.
