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

  it('all fields absent → UNVERIFIABLE, never reported as drift (token-visibility class)', () => {
    // D1's first live run: the Actions GITHUB_TOKEN cannot see REST merge-policy
    // fields, so a HEALTHY posture read as all-absent and was misreported as
    // drift. Absent must be its own verdict with its own remedy (fix the read
    // source, not the settings).
    const v = evaluateMergeConfigPosture({});
    expect(v.conforms).toBe(false);
    expect(v.status).toBe('unverifiable');
    expect(v.drift).toEqual([]);
    expect(v.absent).toHaveLength(5);
    expect(v.message).toMatch(/UNVERIFIABLE/);
    expect(v.message).toMatch(/token-visibility/);
    expect(v.message).not.toMatch(/DRIFTED/);
  });

  it('null fields (GraphQL null) behave as absent, not as drift', () => {
    const v = evaluateMergeConfigPosture({
      ...CONFORMING,
      squash_merge_commit_title: null,
    });
    expect(v.status).toBe('unverifiable');
    expect(v.absent).toEqual(['squash_merge_commit_title']);
  });

  it('a present-and-wrong field wins over absent fields: status=drift, absentees named', () => {
    const v = evaluateMergeConfigPosture({
      allow_merge_commit: true,
    });
    expect(v.status).toBe('drift');
    expect(v.drift).toHaveLength(1);
    expect(v.absent).toHaveLength(4);
    expect(v.message).toMatch(/DRIFTED/);
    expect(v.message).toMatch(/not visible to this token/);
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
