import { describe, expect, it } from 'vitest';

import { evaluateMergeConfigPosture } from './merge-config.js';

describe('evaluateMergeConfigPosture (D1 posture assertion, #1762 E-lever addendum)', () => {
  it('conforms when title=PR_TITLE and message=BLANK', () => {
    const v = evaluateMergeConfigPosture({
      squash_merge_commit_title: 'PR_TITLE',
      squash_merge_commit_message: 'BLANK',
    });
    expect(v.conforms).toBe(true);
    expect(v.drift).toEqual([]);
    expect(v.message).toMatch(/conforms/i);
  });

  it('flags title drift', () => {
    const v = evaluateMergeConfigPosture({
      squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
      squash_merge_commit_message: 'BLANK',
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(1);
    expect(v.drift[0]).toMatch(/squash_merge_commit_title/);
    expect(v.message).toMatch(/DRIFTED/);
  });

  it('flags message drift', () => {
    const v = evaluateMergeConfigPosture({
      squash_merge_commit_title: 'PR_TITLE',
      squash_merge_commit_message: 'COMMIT_MESSAGES',
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(1);
    expect(v.drift[0]).toMatch(/squash_merge_commit_message/);
  });

  it('flags BOTH fields when both drift', () => {
    const v = evaluateMergeConfigPosture({
      squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
      squash_merge_commit_message: 'COMMIT_MESSAGES',
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(2);
  });

  it('treats absent fields as drift (never assumes the posture)', () => {
    const v = evaluateMergeConfigPosture({});
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(2);
    expect(v.message).toMatch(/\(absent\)/);
  });
});
