## Lesson — ESM intra-module mock requires re-binding

**Tags:** style, curated
**Pattern:** \.\.\.\s*await\s+vi\.importActual\(
**Engine:** regex
**Scope:** \*\*/*.test.ts, **/\*.test.tsx, **/_.spec.ts, \*\*/_.spec.tsx
**Severity:** warning

ESM intra-module mocks require re-binding: spreading vi.importActual() retains closure references to real exports. Re-bind callers to use the mocked factory instead.
