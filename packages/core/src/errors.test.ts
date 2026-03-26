import { describe, expect, it } from 'vitest';

import { rethrowAsParseError, TotemError, TotemParseError } from './errors.js';

describe('TotemError cause chains', () => {
  it('retains original error cause in TotemError', () => {
    const original = new Error('original problem');
    const wrapped = new TotemError('PARSE_FAILED', 'wrapper', 'fix it', original);
    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).toContain('wrapper');
  });

  it('retains cause in subclasses', () => {
    const original = new TypeError('type mismatch');
    const wrapped = new TotemParseError('parse failed', 'check syntax', original);
    expect(wrapped.cause).toBe(original);
  });

  it('rethrowAsParseError preserves cause', () => {
    const original = new Error('AST failure');
    try {
      rethrowAsParseError('AST query', original, 'check syntax');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemParseError);
      expect((err as TotemParseError).cause).toBe(original);
      return;
    }
    throw new Error('should have thrown');
  });
});
