## Lesson — Hooks designed to block agent actions, such as shield gates

**Tags:** architecture, curated
**Pattern:** \b(exec|spawn|execFile)\s*\(
**Engine:** regex
**Scope:** **/hooks/**/*.ts, **/shield/**/*.ts, **/gates/**/*.ts, **/git/**/*.ts, !**/*.test.ts
**Severity:** error

Hooks designed to block agent actions (shield gates) must use synchronous execution (e.g., execSync) to ensure the check completes before the action proceeds.
