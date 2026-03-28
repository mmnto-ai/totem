---
"@mmnto/totem": patch
"@mmnto/cli": patch
---

feat: exemption engine, auto-ticket deferred, interactive triage

- Exemption Engine (#917): dual-storage FP tracking (local + shared), 3-strike auto-promotion, --suppress flag, bot review integration
- Auto-ticket (#931): createDeferredIssue service with idempotency, milestone inference, thread reply
- Interactive Triage (#958): Clack prompts for PR triage with fix/defer/dismiss actions
- Ledger: 'exemption' event type for audit trail
- Bot review parser: extractPushbackFindings, shared PUSHBACK_PATTERNS constant
