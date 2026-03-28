// Adversarial corpus: trap-caught for expect.fail
// This code SHOULD trigger a violation.
// Rule: try { ...; expect.fail(...); } catch ($ERR) { ... }
// Bug: expect.fail() throws, so it's caught by the surrounding catch block,
// masking the real assertion failure. Use rejects.toThrow() instead.

import { expect } from 'vitest';

async function runTest(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    expect.fail('should have thrown');
  } catch (err) {
    expect((err as Error).message).toBe('expected error');
  }
}

export { runTest };
