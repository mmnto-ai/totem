---
'@mmnto/totem': patch
---

Compile-worker classifier now warns when a lesson's heading suggests test-contract intent (`test`, `tests`, `spec`, `assertion`, `contract`) but its explicit `**Scope:**` excludes test files (`!**/*.test.*`, `!**/*.spec.*`, `!**/__tests__/**`, `!**/tests/**`) — `mmnto-ai/totem#1752`. Surfaces the wording/scope mismatch at compile time so the author can align the surfaces before the rule lands in the agent-mirror exports (`.github/copilot-instructions.md`, etc.) where the contradiction visually erodes clarity.

Non-blocking warning emitted via the existing `CompileLessonCallbacks.onWarn` hook. The rule itself still compiles per its declared scope. Surfaced as a warning rather than a reject because heading wording is heuristic and false positives on creative phrasings are acceptable.

Sibling to `mmnto-ai/totem#1626` (test-contract scope classifier promotes test-inclusive globs when the `testing` tag aligns with test-framework call signals) and `mmnto-ai/totem#1702` (rejects test-scoped enforcement rules without the `testing` tag) — the third sub-dimension on the same wording/scope axis.
