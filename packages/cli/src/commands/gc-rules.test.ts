import { describe, expect, it } from 'vitest';

import type { GarbageCollectionConfig } from '@mmnto/totem';

import type { RuleGcInput, RuleMetrics } from './gc-rules.js';
import { shouldArchiveRule } from './gc-rules.js';

// Fixed reference date for deterministic tests
const NOW = new Date('2026-03-30T00:00:00.000Z');

/** Helper: create a compiledAt date N days before NOW */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Default GC config used across tests */
const defaultGcConfig: GarbageCollectionConfig = {
  enabled: true,
  minAgeDays: 90,
  exemptCategories: ['security'],
};

describe('shouldArchiveRule', () => {
  it('protects rules matching exemptCategories from decay regardless of zero triggers', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(120),
      category: 'security',
      status: 'active',
    };
    const metrics: RuleMetrics = { triggerCount: 0, suppressCount: 0 };

    const result = shouldArchiveRule(rule, metrics, defaultGcConfig, NOW);
    expect(result).toBeNull();
  });

  it('archives rule with zero triggers after minAgeDays', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(100),
      status: 'active',
    };
    const metrics: RuleMetrics = { triggerCount: 0, suppressCount: 0 };

    const result = shouldArchiveRule(rule, metrics, defaultGcConfig, NOW);
    expect(result).toBeTypeOf('string');
    expect(result).toContain('100');
  });

  it('protects young rules from GC', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(30),
      status: 'active',
    };
    const metrics: RuleMetrics = { triggerCount: 0, suppressCount: 0 };

    const result = shouldArchiveRule(rule, metrics, defaultGcConfig, NOW);
    expect(result).toBeNull();
  });

  it('protects rules with activity from GC', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(120),
      status: 'active',
    };
    const metrics: RuleMetrics = { triggerCount: 5, suppressCount: 0 };

    const result = shouldArchiveRule(rule, metrics, defaultGcConfig, NOW);
    expect(result).toBeNull();
  });

  it('protects already archived rules', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(120),
      status: 'archived',
    };
    const metrics: RuleMetrics = { triggerCount: 0, suppressCount: 0 };

    const result = shouldArchiveRule(rule, metrics, defaultGcConfig, NOW);
    expect(result).toBeNull();
  });

  it('archives rule with no metrics record', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(100),
      status: 'active',
    };

    const result = shouldArchiveRule(rule, undefined, defaultGcConfig, NOW);
    expect(result).toBeTypeOf('string');
    expect(result).toContain('100');
  });

  it('protects rules with only suppressions', () => {
    const rule: RuleGcInput = {
      lessonHash: 'abc123',
      compiledAt: daysAgo(120),
      status: 'active',
    };
    const metrics: RuleMetrics = { triggerCount: 0, suppressCount: 3 };

    const result = shouldArchiveRule(rule, metrics, defaultGcConfig, NOW);
    expect(result).toBeNull();
  });
});
