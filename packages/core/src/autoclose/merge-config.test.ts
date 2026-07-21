import { describe, expect, it } from 'vitest';

import { evaluateMergeConfigPosture, type MergeConfigPosture } from './merge-config.js';

/** A fully-conforming posture: E lever (PR_TITLE + BLANK) + squash-only. */
const CONFORMING: MergeConfigPosture = {
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'BLANK',
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
};

describe('evaluateMergeConfigPosture (D1 posture assertion, #1762 E-lever + squash-only)', () => {
  it('conforms when all five fields match the required posture', () => {
    const v = evaluateMergeConfigPosture(CONFORMING);
    expect(v.conforms).toBe(true);
    expect(v.drift).toEqual([]);
    expect(v.message).toMatch(/conforms/i);
  });

  it('flags title drift', () => {
    const v = evaluateMergeConfigPosture({
      ...CONFORMING,
      squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(1);
    expect(v.drift[0]).toMatch(/squash_merge_commit_title/);
    expect(v.message).toMatch(/DRIFTED/);
  });

  it('flags message drift', () => {
    const v = evaluateMergeConfigPosture({
      ...CONFORMING,
      squash_merge_commit_message: 'COMMIT_MESSAGES',
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(1);
    expect(v.drift[0]).toMatch(/squash_merge_commit_message/);
  });

  it('flags allow_squash_merge drift (must be on)', () => {
    const v = evaluateMergeConfigPosture({ ...CONFORMING, allow_squash_merge: false });
    expect(v.conforms).toBe(false);
    expect(v.drift[0]).toMatch(/allow_squash_merge/);
  });

  it('flags allow_merge_commit drift (must be off — codex supplement)', () => {
    const v = evaluateMergeConfigPosture({ ...CONFORMING, allow_merge_commit: true });
    expect(v.conforms).toBe(false);
    expect(v.drift[0]).toMatch(/allow_merge_commit/);
  });

  it('flags allow_rebase_merge drift (must be off — codex supplement)', () => {
    const v = evaluateMergeConfigPosture({ ...CONFORMING, allow_rebase_merge: true });
    expect(v.conforms).toBe(false);
    expect(v.drift[0]).toMatch(/allow_rebase_merge/);
  });

  it('flags EVERY axis when all five drift', () => {
    const v = evaluateMergeConfigPosture({
      squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
      squash_merge_commit_message: 'COMMIT_MESSAGES',
      allow_squash_merge: false,
      allow_merge_commit: true,
      allow_rebase_merge: true,
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(5);
  });

  it('treats absent fields as drift (never assumes the posture)', () => {
    const v = evaluateMergeConfigPosture({});
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(5);
    expect(v.message).toMatch(/\(absent\)/);
  });

  it('the current live totem posture (all three methods on) drifts on the two off-axes', () => {
    // codex supplement: live gh api reported allow_merge_commit=true,
    // allow_rebase_merge=true, allow_squash_merge=true — so squash-only fails
    // until the operator flips it (D1 reds loudly by design until then).
    const v = evaluateMergeConfigPosture({
      ...CONFORMING,
      allow_merge_commit: true,
      allow_rebase_merge: true,
    });
    expect(v.conforms).toBe(false);
    expect(v.drift).toHaveLength(2);
  });
});
