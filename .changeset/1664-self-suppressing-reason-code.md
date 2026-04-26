---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

fix(core): emit `self-suppressing-pattern` reasonCode for self-suppressing skips (#1664)

Strategy upstream-feedback item 021 substrate. Pre-fix, the compile worker silently dropped lessons whose compiled pattern would match `totem-ignore` / `totem-context` (and self-suppress at runtime) — the rejection mapped to `pattern-syntax-invalid` (a retry-pending code), so the lesson never landed in `nonCompilable`. Bot reviewers reading `compiled-rules.json` would synthesize "missing from manifest" findings because the audit trail was empty.

- New `'self-suppressing-pattern'` member on `NonCompilableReasonCodeSchema`. Sibling to `'context-required'` (#1639) and `'semantic-analysis-required'` (#1640) — both are terminal classifier codes for structural incapacity.
- Terminal write-policy: NOT in `LEDGER_RETRY_PENDING_CODES`, so `shouldWriteToLedger('self-suppressing-pattern')` returns true. Self-suppression is structural — the same lesson body would produce the same self-suppressing pattern on every retry, so retry-pending would loop forever.
- `classifyBuildRejectReason` updated: rejection messages containing `'suppression directive'` now map to `'self-suppressing-pattern'` (was: `'pattern-syntax-invalid'`). Other rejection paths (`'Rejected regex'`, `'Invalid ast-grep pattern'`) keep their existing mappings.
- Bot reviewers can now cite the explicit `reasonCode: 'self-suppressing-pattern'` entry in `nonCompilable` instead of inferring "this lesson is missing" from headcount mismatches.
