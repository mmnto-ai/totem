## Lesson — Prefer Vitest's expect().rejects.toHaveProperty()

**Tags:** style, curated
**Pattern:** \bexpect\.fail\(
**Engine:** regex
**Scope:** **/*.test.ts, **/*.test.js, **/*.spec.ts, **/*.spec.js
**Severity:** warning

Prefer Vitest's expect().rejects.toHaveProperty() assertions over manual try/catch blocks with expect.fail()
