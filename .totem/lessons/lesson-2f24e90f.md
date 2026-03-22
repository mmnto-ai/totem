## Lesson — Prefer Vitest's expect().rejects.toHaveProperty()

**Tags:** style, curated
**Engine:** ast-grep
**Severity:** warning
**Scope:** **/*.test.ts, **/*.spec.ts
**Pattern:** `try { $$$PRE; expect.fail($$$ARGS); $$$POST } catch ($ERR) { $$$CATCH }`

Prefer Vitest's expect().rejects.toHaveProperty().
