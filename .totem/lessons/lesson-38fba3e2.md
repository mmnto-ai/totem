## Lesson — Hooks designed to block agent actions, such as shield gates

**Tags:** architecture, curated
**Pattern:** \b(exec|spawn|execFile)\s*\(
**Engine:** regex
**Scope:** **/hooks/**/*.ts, **/shield/**/_.ts, **/gates/**/_.ts, **/git/**/_.ts, !\*\*/_.test.ts
**Severity:** error

Hooks designed to block agent actions (shield gates) must use synchronous execution (e.g., execSync) to ensure the check completes before the action proceeds.
