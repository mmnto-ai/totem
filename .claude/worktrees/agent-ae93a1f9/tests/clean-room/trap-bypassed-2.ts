// Adversarial corpus: trap-bypassed for expect.fail
// This code SHOULD NOT trigger a violation.
// Uses rejects.toThrow() which correctly asserts on async rejections
// without the try/catch anti-pattern.

import { expect } from 'vitest';

async function runTest(fn: () => Promise<void>): Promise<void> {
  await expect(fn()).rejects.toThrow('expected error');
}

export { runTest };
