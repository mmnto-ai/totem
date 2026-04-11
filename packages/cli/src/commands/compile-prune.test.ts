import { describe, expect, it } from 'vitest';

import { pruneStaleNonCompilable } from './compile.js';

describe('pruneStaleNonCompilable', () => {
  it('returns empty result when the map is empty', () => {
    const result = pruneStaleNonCompilable(new Map(), new Set(['abc', 'def']));
    expect(result.fresh).toEqual([]);
    expect(result.drained).toBe(0);
  });

  it('returns all entries when every hash is still current', () => {
    const map = new Map<string, string>([
      ['abc', 'First lesson'],
      ['def', 'Second lesson'],
    ]);
    const current = new Set(['abc', 'def']);

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([
      { hash: 'abc', title: 'First lesson' },
      { hash: 'def', title: 'Second lesson' },
    ]);
    expect(result.drained).toBe(0);
  });

  it('drops entries whose hashes are no longer present in current lessons', () => {
    const map = new Map<string, string>([
      ['abc', 'Kept lesson'],
      ['stale1', 'Removed lesson A'],
      ['stale2', 'Removed lesson B'],
    ]);
    const current = new Set(['abc']);

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([{ hash: 'abc', title: 'Kept lesson' }]);
    expect(result.drained).toBe(2);
  });

  it('drains everything when no hashes are current', () => {
    const map = new Map<string, string>([
      ['stale1', 'Removed A'],
      ['stale2', 'Removed B'],
    ]);
    const current = new Set<string>();

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([]);
    expect(result.drained).toBe(2);
  });

  it('preserves tuple shape including titles from legacy-normalized entries', () => {
    // Legacy string-form entries get normalized to {hash, title: '(legacy entry)'}
    // by the schema transform. The prune helper must preserve that title verbatim.
    const map = new Map<string, string>([['legacy-hash', '(legacy entry)']]);
    const current = new Set(['legacy-hash']);

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([{ hash: 'legacy-hash', title: '(legacy entry)' }]);
    expect(result.drained).toBe(0);
  });

  it('does not mutate the input map', () => {
    const map = new Map<string, string>([
      ['abc', 'Kept'],
      ['stale', 'Removed'],
    ]);
    const current = new Set(['abc']);

    pruneStaleNonCompilable(map, current);

    // Input map is unchanged — caller decides whether to mutate
    expect(map.size).toBe(2);
    expect(map.has('stale')).toBe(true);
  });
});
