---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

Phase 2: Import Engine foundations

- Lesson retirement ledger (.totem/retired-lessons.json) prevents re-extraction of intentionally removed rules
- Compiler guard rejects self-suppressing patterns (totem-ignore/totem-context/shield-context)
- ESLint adapter: no-restricted-properties (dot, optional chaining, bracket notation) and no-restricted-syntax (ForInStatement, WithStatement, DebuggerStatement) handlers
- Model defaults updated: claude-sonnet-4-6 (Anthropic), gpt-5.4-mini (OpenAI)
- Supported models reference refreshed (2026-04-04)
