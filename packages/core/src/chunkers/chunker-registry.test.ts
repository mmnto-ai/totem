/**
 * Tests for the chunker registry (mmnto-ai/totem#1769, ADR-097 § 5 Q3).
 *
 * Covers invariants 4-9 + 11 (chunker side) from
 * `.totem/specs/pack-substrate-bundle.md`:
 *
 * - All five built-in chunkers self-register at module load.
 * - Pack-style registration adds new entries.
 * - Re-registration of the same name throws.
 * - Registering a built-in name throws (immutable).
 * - Post-seal mutation throws.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ContentType } from '../config-schema.js';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';
import {
  __resetForTests,
  __unsealForTests,
  isBuiltin,
  isSealed,
  lookup,
  register,
  registeredNames,
  seal,
} from './chunker-registry.js';

class FakeChunker implements Chunker {
  readonly strategy: string = 'fake-strategy';
  chunk(_content: string, _filePath: string, _type: ContentType): Chunk[] {
    return [];
  }
}

class AnotherFakeChunker implements Chunker {
  readonly strategy: string = 'another-fake';
  chunk(_content: string, _filePath: string, _type: ContentType): Chunk[] {
    return [];
  }
}

afterEach(() => {
  // Each test gets a fresh registry with built-ins re-registered. Without
  // this, a sealed registry from a prior test would leak into subsequent
  // ones and they'd all fail with "after seal" errors.
  __resetForTests();
});

describe('chunker-registry built-ins', () => {
  it('registers all five built-in chunkers at module load', () => {
    expect(lookup('session-log')).toBeDefined();
    expect(lookup('markdown-heading')).toBeDefined();
    expect(lookup('typescript-ast')).toBeDefined();
    expect(lookup('schema-file')).toBeDefined();
    expect(lookup('test-file')).toBeDefined();
  });

  it('exposes registered names sorted alphabetically', () => {
    expect(registeredNames()).toEqual([
      'markdown-heading',
      'schema-file',
      'session-log',
      'test-file',
      'typescript-ast',
    ]);
  });

  it('marks built-ins as built-in', () => {
    expect(isBuiltin('markdown-heading')).toBe(true);
    expect(isBuiltin('typescript-ast')).toBe(true);
    expect(isBuiltin('not-a-real-strategy')).toBe(false);
  });
});

describe('chunker-registry pack-style registration', () => {
  it('accepts new strategy registration before seal', () => {
    register('fake-strategy', FakeChunker);
    expect(lookup('fake-strategy')).toBe(FakeChunker);
    expect(registeredNames()).toContain('fake-strategy');
  });

  it('does not mark pack-registered names as built-in', () => {
    register('fake-strategy', FakeChunker);
    expect(isBuiltin('fake-strategy')).toBe(false);
  });

  it('throws when re-registering the same strategy name (pack-vs-pack collision)', () => {
    register('fake-strategy', FakeChunker);
    expect(() => register('fake-strategy', AnotherFakeChunker)).toThrowError(
      /already registered.*pack-vs-pack collision/,
    );
  });

  it('throws when registering a built-in name (built-ins immutable)', () => {
    expect(() => register('markdown-heading', FakeChunker)).toThrowError(
      /already registered.*as a built-in.*immutable/,
    );
  });
});

describe('chunker-registry seal contract', () => {
  it('starts unsealed', () => {
    expect(isSealed()).toBe(false);
  });

  it('seal() flips the flag', () => {
    seal();
    expect(isSealed()).toBe(true);
  });

  it('register() after seal throws with ADR-097 § 5 Q5 reference', () => {
    seal();
    expect(() => register('fake-strategy', FakeChunker)).toThrowError(
      /after engine seal.*ADR-097 § 5 Q5/,
    );
  });

  it('__unsealForTests reverts the seal so subsequent tests can register', () => {
    seal();
    expect(isSealed()).toBe(true);
    __unsealForTests();
    expect(isSealed()).toBe(false);
    register('fake-strategy', FakeChunker);
    expect(lookup('fake-strategy')).toBe(FakeChunker);
  });
});
