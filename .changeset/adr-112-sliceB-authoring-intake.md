---
'@mmnto/cli': minor
'@mmnto/totem': patch
---

feat(spine): ADR-112 Slice B — authored-rule producer surface (`totem rule author`)

Adds the human-authoring front door for the Gate-1 authored-rule producer (strategy#591, ADR-112 §3/§8):

- **`totem rule author`** ingests `.totem/spine/authored-rules.yaml` into authored rules + a fail-loud §8 authoring-ledger (`.totem/spine/authoring-ledger.ndjson`).
- The reader re-runs the **independent** structural-eligibility check and **overwrites** any author-supplied verdict — the strict `AuthoredRuleInput` schema makes producer-owned fields (`structuralEligibility`/`decidable`/`ruleId`/`disposition`/…) inexpressible in the hand-editable YAML (FM(d) trust boundary).
- Stable identity via **upsert on `(author, targetDefect)`** — idempotent re-reads (no duplicate ledger rows), a `dslSource` edit revises in place, a `targetDefect` edit re-identifies.
- The fail-loud authoring-ledger is read-back-verified on every append (FM(e)); a non-decidable rule is surfaced loudly and excluded, never silently dropped.
- The decidable-class whitelist ships **inert/pluggable** (mechanism only; the cert-#1 class set is delivered as data later).

Inert producer: records + ledger are written but not yet consumed by the compiler or scorer (Slices B2/C/D). Mined behaviour is unchanged.
