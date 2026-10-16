## Lesson — A node:fs failure seam in a vitest test is a hoisted

**Tags:** testing, vitest, esm, node-fs, seam, trap

**Applies-to:** boundary-test

A node:fs failure seam in a vitest test is a hoisted vi.mock of the module, never vi.spyOn on the namespace. `vi.spyOn(fs, 'readFileSync')` cannot rebind a frozen ESM namespace import (`import * as fs from 'node:fs'`, or a named import), so the spy installs on a copy and the code under test still calls the real read; a hoisted `vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal()), readFileSync: vi.fn() }))` in the shape of packages/cli/src/commands/ecl-gc.test.ts replaces the binding the module resolves. Exhibit: the pilot-state read-outcome seam on mmnto-ai/totem#3084 (Greptile's second pass, 2026-10-14: a transient read failure reported as a reset), five unit tests over the mock.

**Source:** mcp (added at 2026-10-16T00:49:32.921Z)
