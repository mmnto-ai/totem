## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, curated
**Pattern:** \bstripAnsi\b
**Engine:** regex
**Scope:** packages/mcp/**/*.ts, !**/*.test.ts
**Severity:** error

Do not apply terminal sanitization (like stripAnsi) to data intended for LLM prompts. Terminal sanitization is a presentation-layer concern for CLI output, while LLMs need raw data (including code symbols) to maintain fidelity. Use prompt-specific sanitization (like XML escaping) instead.
