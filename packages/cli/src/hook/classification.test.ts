import { describe, expect, it } from 'vitest';

import { classifyHookRule } from './classification.js';
import type { HookRule } from './schema.js';

const baseRule: HookRule = {
  id: 'r1',
  trigger: { tool: 'bash', pattern: '.*' },
  check: { pattern: 'x', type: 'reject-if-match' },
  message: 'm',
};

describe('classifyHookRule', () => {
  it('returns interpretive with no warning for a plain hook rule', () => {
    const result = classifyHookRule(baseRule);
    expect(result.classification).toBe('interpretive');
    expect(result.warning).toBeUndefined();
  });

  it('returns interpretive but emits a warn-and-ignore signal when verification_shadow is present', () => {
    const withShadow: HookRule = {
      ...baseRule,
      verification_shadow: { rego: 'package x' },
    };
    const result = classifyHookRule(withShadow);
    expect(result.classification).toBe('interpretive');
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('[totem:hook-shadow-ignored]');
    expect(result.warning).toContain('r1');
  });

  it('treats verification_shadow: null as present (warns and continues)', () => {
    // null is a JS-truthy distinct from undefined; if the schema admits it the
    // classification helper should still emit the warn-and-ignore signal so
    // the dispatch contract holds for any non-undefined value.
    const withNullShadow: HookRule = {
      ...baseRule,
      id: 'r-null',
      verification_shadow: null,
    };
    const result = classifyHookRule(withNullShadow);
    expect(result.classification).toBe('interpretive');
    expect(result.warning).toBeDefined();
  });
});
