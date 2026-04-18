import { describe, expect, it } from 'vitest';

import type { CompiledRule } from '@mmnto/totem';

import type { NonCompilableMapValue } from './compile.js';
import { pruneStaleNonCompilable, pruneStaleRules } from './compile.js';

// ─── 4-tuple helpers (mmnto-ai/totem#1481) ───────────

function entry(
  title: string,
  reasonCode: NonCompilableMapValue['reasonCode'] = 'out-of-scope',
  reason?: string,
): NonCompilableMapValue {
  return reason === undefined ? { title, reasonCode } : { title, reasonCode, reason };
}

// ─── Test helpers ────────────────────────────────────

function makeRule(lessonHash: string, heading = `Heading for ${lessonHash}`): CompiledRule {
  return {
    lessonHash,
    lessonHeading: heading,
    pattern: 'dummy',
    message: heading,
    engine: 'regex',
    compiledAt: '2026-04-10T00:00:00Z',
  };
}

describe('pruneStaleNonCompilable', () => {
  it('returns empty result when the map is empty', () => {
    const result = pruneStaleNonCompilable(new Map(), new Set(['abc', 'def']));
    expect(result.fresh).toEqual([]);
    expect(result.drained).toBe(0);
  });

  it('returns all entries when every hash is still current', () => {
    const map = new Map<string, NonCompilableMapValue>([
      ['abc', entry('First lesson')],
      ['def', entry('Second lesson', 'missing-badexample')],
    ]);
    const current = new Set(['abc', 'def']);

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([
      { hash: 'abc', title: 'First lesson', reasonCode: 'out-of-scope' },
      { hash: 'def', title: 'Second lesson', reasonCode: 'missing-badexample' },
    ]);
    expect(result.drained).toBe(0);
  });

  it('drops entries whose hashes are no longer present in current lessons', () => {
    const map = new Map<string, NonCompilableMapValue>([
      ['abc', entry('Kept lesson')],
      ['stale1', entry('Removed lesson A')],
      ['stale2', entry('Removed lesson B')],
    ]);
    const current = new Set(['abc']);

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([
      { hash: 'abc', title: 'Kept lesson', reasonCode: 'out-of-scope' },
    ]);
    expect(result.drained).toBe(2);
  });

  it('drains everything when no hashes are current', () => {
    const map = new Map<string, NonCompilableMapValue>([
      ['stale1', entry('Removed A')],
      ['stale2', entry('Removed B')],
    ]);
    const current = new Set<string>();

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([]);
    expect(result.drained).toBe(2);
  });

  it('preserves reasonCode and reason fields through the prune', () => {
    // mmnto-ai/totem#1481 invariant #8: the 4-tuple must survive the prune
    // intact, not collapse back to a 2-tuple.
    const map = new Map<string, NonCompilableMapValue>([
      ['hash-a', entry('Legacy entry', 'legacy-unknown')],
      ['hash-b', entry('Modern entry', 'out-of-scope', 'Architectural principle.')],
    ]);
    const current = new Set(['hash-a', 'hash-b']);

    const result = pruneStaleNonCompilable(map, current);

    expect(result.fresh).toEqual([
      { hash: 'hash-a', title: 'Legacy entry', reasonCode: 'legacy-unknown' },
      {
        hash: 'hash-b',
        title: 'Modern entry',
        reasonCode: 'out-of-scope',
        reason: 'Architectural principle.',
      },
    ]);
    expect(result.drained).toBe(0);
  });

  it('does not mutate the input map', () => {
    const map = new Map<string, NonCompilableMapValue>([
      ['abc', entry('Kept')],
      ['stale', entry('Removed')],
    ]);
    const current = new Set(['abc']);

    pruneStaleNonCompilable(map, current);

    // Input map is unchanged — caller decides whether to mutate
    expect(map.size).toBe(2);
    expect(map.has('stale')).toBe(true);
  });
});

describe('pruneStaleRules', () => {
  it('returns an empty result when the input rules array is empty', () => {
    const result = pruneStaleRules([], new Set(['abc']));
    expect(result.fresh).toEqual([]);
    expect(result.pruned).toBe(0);
  });

  it('keeps all rules when every lessonHash is still current', () => {
    const rules = [makeRule('abc'), makeRule('def')];
    const result = pruneStaleRules(rules, new Set(['abc', 'def']));

    expect(result.fresh).toHaveLength(2);
    expect(result.fresh.map((r) => r.lessonHash)).toEqual(['abc', 'def']);
    expect(result.pruned).toBe(0);
  });

  it('drops rules whose source lesson has been removed', () => {
    const rules = [makeRule('abc'), makeRule('removed-1'), makeRule('removed-2')];
    const result = pruneStaleRules(rules, new Set(['abc']));

    expect(result.fresh.map((r) => r.lessonHash)).toEqual(['abc']);
    expect(result.pruned).toBe(2);
  });

  it('drains everything when no lessonHash matches', () => {
    const rules = [makeRule('stale-1'), makeRule('stale-2')];
    const result = pruneStaleRules(rules, new Set<string>());

    expect(result.fresh).toEqual([]);
    expect(result.pruned).toBe(2);
  });

  it('preserves rule identity and field order for kept rules', () => {
    const ruleA = makeRule('abc', 'Heading A');
    const ruleB = makeRule('def', 'Heading B');
    const result = pruneStaleRules([ruleA, ruleB], new Set(['abc', 'def']));

    // Kept rules are the same object references, so metadata (compiledAt,
    // createdAt, etc.) is preserved verbatim — important for audit lineage.
    expect(result.fresh[0]).toBe(ruleA);
    expect(result.fresh[1]).toBe(ruleB);
  });

  it('does not mutate the input array', () => {
    const rules = [makeRule('abc'), makeRule('stale')];
    pruneStaleRules(rules, new Set(['abc']));

    expect(rules).toHaveLength(2);
    expect(rules[1]!.lessonHash).toBe('stale');
  });
});
