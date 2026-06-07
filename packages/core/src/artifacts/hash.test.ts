import { describe, expect, it } from 'vitest';

import { calculateDeterministicHash } from './hash.js';

describe('calculateDeterministicHash', () => {
  it('guarantees identical hashes for objects with different key insertion orders', () => {
    const a = {
      inputBundle: { maskedPrompt: 'p', diffScope: 'd' },
      backend: { provider: 'gemini', model: 'm' },
      schemaVersion: '1.0.0',
    };
    const b = {
      schemaVersion: '1.0.0',
      backend: { model: 'm', provider: 'gemini' },
      inputBundle: { diffScope: 'd', maskedPrompt: 'p' },
    };
    expect(calculateDeterministicHash(a)).toBe(calculateDeterministicHash(b));
  });

  it('sorts keys recursively, not just at the top level', () => {
    const a = { outer: { z: { b: 2, a: 1 }, y: [1, 2] } };
    const b = { outer: { y: [1, 2], z: { a: 1, b: 2 } } };
    expect(calculateDeterministicHash(a)).toBe(calculateDeterministicHash(b));
  });

  it('preserves array order as significant (reordered arrays hash differently)', () => {
    expect(calculateDeterministicHash({ items: [1, 2] })).not.toBe(
      calculateDeterministicHash({ items: [2, 1] }),
    );
  });

  it('produces distinct hashes for distinct payloads', () => {
    expect(calculateDeterministicHash({ a: 1 })).not.toBe(calculateDeterministicHash({ a: 2 }));
  });

  it('returns 64-char lowercase sha256 hex', () => {
    expect(calculateDeterministicHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats null and absent fields as distinct payloads', () => {
    expect(calculateDeterministicHash({ a: null })).not.toBe(calculateDeterministicHash({}));
  });
});
