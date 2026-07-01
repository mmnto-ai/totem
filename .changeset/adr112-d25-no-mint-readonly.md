---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-112 §8 Slice D2.5 — read-only / no-mint precondition on the authored cert-corpus producer (strategy ruling 2026-06-30, Q1–Q4).

`buildAuthoredCertifyingCorpus` re-derives the authored records via `runRuleAuthor` (the writer) during cert-corpus assembly. D2's step-0 gate checks only that the authoring-ledger is NON-EMPTY — not that no rule is minted/revised — so a cert run over a stale `authored-rules.yaml` (a new or edited rule) would mint/revise it and certify its own mint (the CodeRabbit Major on #2274, deferred from D2). A cert run is NOT the first author.

- **`runRuleAuthor` gains a `verifyOnly` mode** (`@mmnto/cli`): a cert-run re-derive runs Pass 1 (pure eligibility/identity/contentHash) and fails loud (`GATE_INVALID`, naming the rule(s) + `minted`/`revised`) BEFORE Pass 2's first ledger append if any current rule would be `minted` or `revised` — only `unchanged` passes (revise is forbidden identically to mint). Zero ledger writes on the throw (Tenet-4 no-drift). It is the read-side sibling of D2's §8 source-flip: the cert-run re-read writes nothing and asserts all-unchanged (Tenet-13 sensor-not-actuator).
- **`buildAuthoredCertifyingCorpus` always calls `verifyOnly: true`** (`@mmnto/cli`) — the cert path is read-only against the authoring-ledger; the authoring path (`totem rule author`) is unchanged and still mints/revises (cert-path-only scope).
- Composes with — does not replace — the producer's step-0 empty-ledger and step-3 judgedBy/split gates (layered: empty → no-mint stale → verdict/binding divergence).

Couples strategy's ADR-112 §8 no-mint-precondition amendment (couple-on-merge, the #789⊕#2274 pattern). Still INERT until D3 (scoring ignores `authoredControls`); no production authored lock exists. The §6 window-wide answer-key deriver is a separate follow-on slice (D2.6). closingRefs [].
