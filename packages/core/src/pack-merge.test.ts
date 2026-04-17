import { describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler-schema.js';
import { mergeRules } from './pack-merge.js';

// ─── Helpers ────────────────────────────────────────

const baseRule = (
  overrides: Partial<CompiledRule> & Pick<CompiledRule, 'lessonHash'>,
): CompiledRule =>
  ({
    lessonHeading: 'test-rule',
    message: 'test message',
    pattern: 'pattern-x',
    engine: 'regex',
    compiledAt: '2026-04-17T00:00:00Z',
    ...overrides,
  }) as CompiledRule;

// ─── Tests ──────────────────────────────────────────

describe('mergeRules', () => {
  it('emits pack-only rules unchanged', () => {
    const packRule = baseRule({ lessonHash: 'pack-only' });
    const { rules, blocks } = mergeRules([], [packRule]);
    expect(rules).toEqual([packRule]);
    expect(blocks).toEqual([]);
  });

  it('emits local-only rules unchanged', () => {
    const localRule = baseRule({ lessonHash: 'local-only' });
    const { rules, blocks } = mergeRules([localRule], []);
    expect(rules).toEqual([localRule]);
    expect(blocks).toEqual([]);
  });

  it('returns empty result on empty inputs', () => {
    const { rules, blocks } = mergeRules([], []);
    expect(rules).toEqual([]);
    expect(blocks).toEqual([]);
  });

  it('local rule overrides pack rule when pack is not immutable (ADR-085 default)', () => {
    const packRule = baseRule({
      lessonHash: 'shared',
      severity: 'error',
      message: 'pack message',
    });
    const localRule = baseRule({
      lessonHash: 'shared',
      severity: 'warning',
      message: 'local message',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);
    expect(rules).toEqual([localRule]);
    expect(blocks).toEqual([]);
  });

  it('forces pack severity when local downgrades an immutable+error pack rule', () => {
    const packRule = baseRule({
      lessonHash: 'immut',
      immutable: true,
      severity: 'error',
      message: 'pack enforcement',
    });
    const localRule = baseRule({
      lessonHash: 'immut',
      severity: 'warning',
      message: 'local tries to downgrade',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe('error');
    expect(rules[0]!.immutable).toBe(true);
    // Pattern / message bodies come from the local rule — immutable
    // protects the enforcement knob, not the rule content.
    expect(rules[0]!.message).toBe('local tries to downgrade');
    expect(blocks).toEqual([
      {
        lessonHash: 'immut',
        lessonHeading: 'test-rule',
        attemptedChange: 'severity-downgrade',
        attemptedSeverity: 'warning',
        enforcedSeverity: 'error',
      },
    ]);
  });

  it('blocks archive attempt on an immutable+error pack rule and restores active status', () => {
    const packRule = baseRule({
      lessonHash: 'immut-archive',
      immutable: true,
      severity: 'error',
    });
    const localRule = baseRule({
      lessonHash: 'immut-archive',
      severity: 'error',
      status: 'archived',
      archivedReason: 'local tried to archive a security rule',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe('error');
    expect(rules[0]!.status).toBe('active');
    expect(rules[0]!.archivedReason).toBeUndefined();
    expect(blocks).toEqual([
      {
        lessonHash: 'immut-archive',
        lessonHeading: 'test-rule',
        attemptedChange: 'archive',
        enforcedSeverity: 'error',
      },
    ]);
  });

  it('blocks combined downgrade + archive attempt with attemptedChange: both', () => {
    const packRule = baseRule({
      lessonHash: 'immut-both',
      immutable: true,
      severity: 'error',
    });
    const localRule = baseRule({
      lessonHash: 'immut-both',
      severity: 'warning',
      status: 'archived',
      archivedReason: 'double override attempt',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe('error');
    expect(rules[0]!.status).toBe('active');
    expect(rules[0]!.archivedReason).toBeUndefined();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.attemptedChange).toBe('both');
    expect(blocks[0]!.attemptedSeverity).toBe('warning');
  });

  it('does not force severity when pack is immutable but severity is not error', () => {
    // Immutable currently protects error-level rules only. A pack that
    // declares immutable: true + severity: 'warning' communicates intent
    // but the merge falls back to local precedence — no block reported.
    const packRule = baseRule({
      lessonHash: 'immut-warn',
      immutable: true,
      severity: 'warning',
    });
    const localRule = baseRule({
      lessonHash: 'immut-warn',
      severity: 'warning',
      status: 'archived',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);
    expect(rules).toEqual([localRule]);
    expect(blocks).toEqual([]);
  });

  it('does not treat an omitted local severity as a downgrade attempt', () => {
    // CR finding on #1515: defaulting omitted localRule.severity to
    // 'warning' records bogus blocks for local overrides that simply
    // don't opine on severity. Runtime consumers disagree on the default
    // (finding.ts uses 'error', compile-lesson.ts uses 'warning'), so
    // absence is ambiguous — only an explicit 'warning' counts as a
    // downgrade. The merged rule still gets the pack's 'error' forced.
    const packRule = baseRule({
      lessonHash: 'immut-implicit',
      immutable: true,
      severity: 'error',
    });
    const localRule = baseRule({
      lessonHash: 'immut-implicit',
      // severity intentionally omitted — local has no opinion
      message: 'local refines message only',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe('error');
    expect(rules[0]!.immutable).toBe(true);
    expect(rules[0]!.message).toBe('local refines message only');
    expect(blocks).toEqual([]);
  });

  it('emits no block when the local rule does not attempt to downgrade or archive', () => {
    const packRule = baseRule({
      lessonHash: 'immut-noop',
      immutable: true,
      severity: 'error',
    });
    const localRule = baseRule({
      lessonHash: 'immut-noop',
      severity: 'error',
      message: 'local refines message but keeps severity',
    });
    const { rules, blocks } = mergeRules([localRule], [packRule]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe('error');
    expect(rules[0]!.message).toBe('local refines message but keeps severity');
    expect(rules[0]!.immutable).toBe(true);
    expect(blocks).toEqual([]);
  });

  it('preserves deterministic ordering: pack rules first, then local-only rules', () => {
    const pack1 = baseRule({ lessonHash: 'p1' });
    const pack2 = baseRule({ lessonHash: 'p2' });
    const localOverlap = baseRule({ lessonHash: 'p1', message: 'overrides pack1' });
    const localOnly1 = baseRule({ lessonHash: 'l1' });
    const localOnly2 = baseRule({ lessonHash: 'l2' });

    const { rules } = mergeRules([localOverlap, localOnly1, localOnly2], [pack1, pack2]);
    const hashes = rules.map((r) => r.lessonHash);
    expect(hashes).toEqual(['p1', 'p2', 'l1', 'l2']);
    expect(rules[0]!.message).toBe('overrides pack1');
  });

  it('is a pure function — inputs are not mutated', () => {
    const packRule = baseRule({
      lessonHash: 'immut',
      immutable: true,
      severity: 'error',
    });
    const localRule = baseRule({
      lessonHash: 'immut',
      severity: 'warning',
      status: 'archived',
      archivedReason: 'audit',
    });
    const packSnapshot = JSON.stringify(packRule);
    const localSnapshot = JSON.stringify(localRule);

    mergeRules([localRule], [packRule]);

    expect(JSON.stringify(packRule)).toBe(packSnapshot);
    expect(JSON.stringify(localRule)).toBe(localSnapshot);
  });

  it('handles multiple immutable pack rules with mixed override attempts', () => {
    const p1 = baseRule({
      lessonHash: 'p1',
      immutable: true,
      severity: 'error',
    });
    const p2 = baseRule({
      lessonHash: 'p2',
      immutable: true,
      severity: 'error',
    });
    const p3 = baseRule({
      lessonHash: 'p3',
      immutable: true,
      severity: 'error',
    });
    const l1 = baseRule({ lessonHash: 'p1', severity: 'warning' });
    const l2 = baseRule({ lessonHash: 'p2', status: 'archived' });
    // p3 has no local override — no block, emits pack rule as-is.

    const { rules, blocks } = mergeRules([l1, l2], [p1, p2, p3]);
    expect(rules).toHaveLength(3);
    expect(rules.every((r) => r.severity === 'error')).toBe(true);
    expect(rules.every((r) => r.status !== 'archived')).toBe(true);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.lessonHash).sort()).toEqual(['p1', 'p2']);
  });
});
