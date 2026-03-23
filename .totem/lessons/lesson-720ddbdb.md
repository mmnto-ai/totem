## Lesson — Using require() inside vi.mock callbacks can lead

**Tags:** testing, esm, vitest

Using `require()` inside `vi.mock` callbacks can lead to resolution failures in pure ESM environments due to Vitest's hoisting logic. Developers should use `vi.importActual` or async imports to ensure dependencies are resolved in an ESM-safe manner.
