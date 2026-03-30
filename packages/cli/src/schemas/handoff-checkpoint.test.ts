import { describe, expect, it } from 'vitest';

import { HandoffCheckpointSchema } from './handoff-checkpoint.js';

describe('HandoffCheckpointSchema', () => {
  const ts = '2026-03-30T12:00:00Z';

  it('parses minimal deterministic checkpoint discarding missing semantic fields', () => {
    const result = HandoffCheckpointSchema.parse({
      checkpoint_version: 1,
      timestamp: ts,
      branch: 'feat/checkpoint',
      active_files: ['src/foo.ts', 'src/bar.ts'],
    });
    expect(result.branch).toBe('feat/checkpoint');
    expect(result.active_files).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(result.pending_decisions).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(result.context_hints).toEqual([]);
    expect(result.open_prs).toEqual([]);
  });

  it('parses full checkpoint with all fields populated', () => {
    const result = HandoffCheckpointSchema.parse({
      checkpoint_version: 1,
      timestamp: ts,
      branch: 'main',
      open_prs: [42, 99],
      active_files: ['src/a.ts'],
      pending_decisions: ['choose auth strategy'],
      completed: ['schema defined'],
      remaining: ['wire up LLM'],
      context_hints: ['see ADR-039'],
    });
    expect(result.open_prs).toEqual([42, 99]);
    expect(result.pending_decisions).toEqual(['choose auth strategy']);
    expect(result.completed).toEqual(['schema defined']);
    expect(result.remaining).toEqual(['wire up LLM']);
    expect(result.context_hints).toEqual(['see ADR-039']);
  });

  it('rejects missing required fields', () => {
    expect(() =>
      HandoffCheckpointSchema.parse({
        checkpoint_version: 1,
        timestamp: ts,
        active_files: [],
      }),
    ).toThrow();
  });

  it('rejects invalid checkpoint_version', () => {
    expect(() =>
      HandoffCheckpointSchema.parse({
        checkpoint_version: 2,
        timestamp: ts,
        branch: 'main',
        active_files: [],
      }),
    ).toThrow();
  });

  it('handles detached HEAD branch values', () => {
    for (const branch of ['HEAD', 'abc1234']) {
      const result = HandoffCheckpointSchema.parse({
        checkpoint_version: 1,
        timestamp: ts,
        branch,
        active_files: [],
      });
      expect(result.branch).toBe(branch);
    }
  });
});
