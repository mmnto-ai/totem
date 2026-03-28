---
"@mmnto/totem": minor
"@mmnto/cli": minor
"@mmnto/mcp": minor
---

feat: 1.6.0 — Pipeline Maturity

Exemption Engine (#917):
- Dual-storage false positive tracking (local gitignored + shared committed)
- 3-strike auto-promotion to team-wide suppressions
- --suppress flag for manual pattern suppression
- Bot review pushback → exemption tracking via extractPushbackFindings
- Ledger 'exemption' event type for full audit trail

Auto-ticket Deferred (#931):
- createDeferredIssue service with idempotency and thread reply
- inferNextMilestone for semver-aware milestone assignment
- PrAdapter: createIssue, replyToComment, addPrComment

Interactive Triage CLI (#958):
- totem triage-pr --interactive / -i with Clack prompts
- Per-finding actions: Fix, Defer, Dismiss, Learn, Skip
- TTY guard, isCancel on every prompt, confirm preview

Agent Dispatch (#957):
- dispatchFix: LLM-powered code fix with atomic commit and thread reply
- Path traversal guard, git rollback on failure
- Bot re-trigger: /gemini-review after fixes

Bot-to-Lesson Loop (#959):
- "Learn" action saves findings as lessons with bot-review tags
- Post-triage review-learn prompt for batch extraction
