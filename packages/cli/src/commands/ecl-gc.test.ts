/**
 * Tests for `totem ecl-gc` (mmnto-ai/totem#2279; parent mmnto-ai/totem-strategy#700).
 *
 * Filesystem-driven with an injected clock: every test builds a fresh
 * `<tmp>/.totem/orchestration/<agent>/outbox/` tree, exercises `eclGc`, and
 * asserts on the structured `EclGcResult` AND on the on-disk aftermath (which
 * files survived). The safety rows (peer immunity, non-outbox trees untouched,
 * ambiguity-throws-before-deletion, exact-boundary retention) are written to
 * FAIL if their guard were removed — see the per-test non-vacuity notes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  classifyEntry,
  cutoffKey,
  eclGc,
  type EclGcOptions,
  planPrune,
  toStampKey,
} from './ecl-gc.js';

// `vi.spyOn` cannot rebind a frozen ESM module-namespace export (node:fs), so
// the partial-delete-failure row drives a module mock instead: a hoisted
// fail-set makes the mocked `unlinkSync` throw for named files and pass through
// to the real implementation for everything else. All other fs calls stay real.
const fsMockState = vi.hoisted(() => ({ failFor: new Set<string>() }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    unlinkSync: (p: fs.PathLike, ...rest: unknown[]): void => {
      const name = String(p);
      for (const suffix of fsMockState.failFor) {
        if (name.endsWith(suffix)) {
          throw new Error('EPERM: simulated locked file');
        }
      }
      return (actual.unlinkSync as (target: fs.PathLike, ...r: unknown[]) => void)(p, ...rest);
    },
  };
});

// ─── Fixtures ───────────────────────────────────────────

// Fixed clock so cutoffs are deterministic (Tenet 15). 14-day default window
// puts the cutoff at 2026-06-21T12:00:00Z → key `20260621120000`.
const NOW = new Date('2026-07-05T12:00:00.000Z');
const nowFn = (): Date => NOW;
const CUTOFF_KEY = '20260621120000';

let tmpRoot: string;

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function orchDir(agent: string, sub: string): string {
  return path.join(tmpRoot, '.totem', 'orchestration', agent, sub);
}

/** Write named `.md`-ish files into `<agent>/<sub>/` with dispatch-shaped content. */
function writeFiles(agent: string, sub: string, names: string[]): string {
  const dir = mkDir(orchDir(agent, sub));
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), '---\nto: someone\n---\n\nbody\n', 'utf-8');
  }
  return dir;
}

function exists(agent: string, sub: string, name: string): boolean {
  return fs.existsSync(path.join(orchDir(agent, sub), name));
}

function run(opts: EclGcOptions = {}): ReturnType<typeof eclGc> {
  return eclGc({ repoRoot: tmpRoot, env: {}, now: nowFn, ...opts });
}

// Aged (< cutoff) and fresh (>= cutoff) stamp names for the default 14d window.
const AGED_4 = '2026-06-01T1200Z-totem-gemini.md'; // 20260601120000 < cutoff
const AGED_6 = '2026-06-01T120000Z-totem-gemini.md'; // dual-form, same instant, aged
const AGED_2 = '2026-05-15T0930Z-strategy-claude.md'; // 20260515093000 < cutoff
const FRESH_4 = '2026-07-01T1200Z-totem-gemini.md'; // 20260701120000 >= cutoff
const BOUNDARY_KEEP = '2026-06-21T120000Z-totem-gemini.md'; // === cutoff → kept
const BOUNDARY_PRUNE = '2026-06-21T115959Z-totem-gemini.md'; // 1s older → pruned

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eclgc-'));
});

afterEach(() => {
  fsMockState.failFor.clear();
  vi.restoreAllMocks();
  cleanTmpDir(tmpRoot);
});

// ─── Pure helpers ───────────────────────────────────────

describe('pure helpers', () => {
  it('toStampKey canonicalizes both stamp forms to a 14-digit key', () => {
    expect(toStampKey('2026-06-01T1200Z')).toBe('20260601120000');
    expect(toStampKey('2026-06-01T120000Z')).toBe('20260601120000');
  });

  it('cutoffKey derives now − retainDays as a 14-digit key', () => {
    expect(cutoffKey(NOW, 14)).toBe(CUTOFF_KEY);
    // retainDays 0 → cutoff is `now` itself.
    expect(cutoffKey(NOW, 0)).toBe('20260705120000');
  });

  it('classifyEntry: file-type guard runs before the extension/stamp checks', () => {
    // A directory that LOOKS aged + `.md` must still be skipped, never pruned.
    expect(classifyEntry({ name: AGED_4, isFile: false }, CUTOFF_KEY)).toEqual({
      action: 'skip',
      reason: 'not a regular file',
    });
    expect(classifyEntry({ name: 'x.tmp', isFile: true }, CUTOFF_KEY)).toEqual({
      action: 'skip',
      reason: 'not a .md dispatch',
    });
    expect(classifyEntry({ name: 'not-a-stamp.md', isFile: true }, CUTOFF_KEY)).toEqual({
      action: 'skip',
      reason: 'unparseable stamp',
    });
    expect(classifyEntry({ name: AGED_4, isFile: true }, CUTOFF_KEY)).toEqual({ action: 'prune' });
    expect(classifyEntry({ name: BOUNDARY_KEEP, isFile: true }, CUTOFF_KEY)).toEqual({
      action: 'keep',
    });
  });

  it('planPrune partitions a listing deterministically', () => {
    const plan = planPrune(
      [
        { name: FRESH_4, isFile: true },
        { name: AGED_4, isFile: true },
        { name: 'x.tmp', isFile: true },
        { name: 'sub', isFile: false },
      ],
      CUTOFF_KEY,
    );
    expect(plan.prune).toEqual([AGED_4]);
    expect(plan.kept).toBe(1);
    expect(plan.skipped).toEqual([
      { file: 'sub', reason: 'not a regular file' },
      { file: 'x.tmp', reason: 'not a .md dispatch' },
    ]);
  });
});

// ─── LOAD-BEARING safety rows ───────────────────────────

describe('safety invariants (load-bearing)', () => {
  it('row 1 — peer immunity: pruning seat A never touches seat B', () => {
    writeFiles('seat-a', 'outbox', [AGED_4]);
    writeFiles('seat-b', 'outbox', [AGED_2]);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.agent).toBe('seat-a');
    expect(result.pruned).toEqual([AGED_4]);
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(false);
    // NON-VACUITY: seat-b's aged file must survive — if the target were the
    // whole orchestration tree instead of the resolved seat, this would fail.
    expect(exists('seat-b', 'outbox', AGED_2)).toBe(true);
  });

  it('row 2 — never touches journal/ processed/ inbox/', () => {
    writeFiles('seat-a', 'outbox', [AGED_4]);
    writeFiles('seat-a', 'journal', [AGED_2]);
    writeFiles('seat-a', 'processed', [AGED_2]);
    writeFiles('seat-a', 'inbox', [AGED_2]);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    // The outbox aged file IS pruned (prune actually ran)…
    expect(result.pruned).toEqual([AGED_4]);
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(false);
    // …but the sibling trees are untouched.
    // NON-VACUITY: these fail if the scan ever walked a non-outbox dir.
    expect(exists('seat-a', 'journal', AGED_2)).toBe(true);
    expect(exists('seat-a', 'processed', AGED_2)).toBe(true);
    expect(exists('seat-a', 'inbox', AGED_2)).toBe(true);
  });

  it('row 3 — self-ambiguity throws BEFORE any deletion', () => {
    // Two registered seat dirs, no --agent-id, no TOTEM_SELF_AGENT → ambiguous.
    writeFiles('seat-a', 'outbox', [AGED_4]);
    writeFiles('seat-b', 'outbox', [AGED_2]);

    expect(() => run({ apply: true })).toThrow(/cannot resolve a single agent/i);

    // NON-VACUITY: nothing may be deleted on the throwing path.
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(true);
    expect(exists('seat-b', 'outbox', AGED_2)).toBe(true);
  });

  it('row 4 — exact boundary retained; 1s older pruned', () => {
    writeFiles('seat-a', 'outbox', [BOUNDARY_KEEP, BOUNDARY_PRUNE]);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.cutoffKey).toBe(CUTOFF_KEY);
    expect(result.pruned).toEqual([BOUNDARY_PRUNE]);
    expect(result.kept).toBe(1);
    // NON-VACUITY: a `<=` boundary would delete BOUNDARY_KEEP → this fails.
    expect(exists('seat-a', 'outbox', BOUNDARY_KEEP)).toBe(true);
    expect(exists('seat-a', 'outbox', BOUNDARY_PRUNE)).toBe(false);
  });
});

// ─── Behavioral coverage ────────────────────────────────

describe('behavior', () => {
  it('row 5 — dry-run lists would-prune but deletes nothing', () => {
    writeFiles('seat-a', 'outbox', [AGED_4, FRESH_4]);

    const result = run({ env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.dryRun).toBe(true);
    expect(result.pruned).toEqual([AGED_4]);
    expect(result.failed).toEqual([]);
    // Nothing deleted in dry-run.
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(true);
    expect(exists('seat-a', 'outbox', FRESH_4)).toBe(true);
  });

  it('row 6 — --apply deletes only the aged files; fresh kept', () => {
    writeFiles('seat-a', 'outbox', [AGED_4, AGED_2, FRESH_4]);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.dryRun).toBe(false);
    expect(result.pruned.sort()).toEqual([AGED_2, AGED_4].sort());
    expect(result.kept).toBe(1);
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(false);
    expect(exists('seat-a', 'outbox', AGED_2)).toBe(false);
    expect(exists('seat-a', 'outbox', FRESH_4)).toBe(true);
  });

  it('row 7 — dual-form stamps (4-digit + 6-digit) both classify correctly', () => {
    writeFiles('seat-a', 'outbox', [AGED_4, AGED_6, BOUNDARY_KEEP]);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    // Both aged forms pruned; the 6-digit boundary kept.
    expect(result.pruned.sort()).toEqual([AGED_4, AGED_6].sort());
    expect(result.kept).toBe(1);
    expect(exists('seat-a', 'outbox', BOUNDARY_KEEP)).toBe(true);
  });

  it('row 8 — malformed / non-.md / non-file entries are skipped, never deleted', () => {
    const outbox = writeFiles('seat-a', 'outbox', [AGED_4, '.gitkeep', 'x.tmp', 'not-a-stamp.md']);
    // A directory named like an aged dispatch — must be skipped, not pruned.
    mkDir(path.join(outbox, '2026-01-01T0000Z-olddir.md'));

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.pruned).toEqual([AGED_4]);
    const skippedFiles = result.skipped.map((s) => s.file).sort();
    expect(skippedFiles).toEqual([
      '.gitkeep',
      '2026-01-01T0000Z-olddir.md',
      'not-a-stamp.md',
      'x.tmp',
    ]);
    // NON-VACUITY: the aged-looking subdir survives (file-type guard held).
    expect(fs.existsSync(path.join(outbox, '2026-01-01T0000Z-olddir.md'))).toBe(true);
    expect(exists('seat-a', 'outbox', '.gitkeep')).toBe(true);
    expect(exists('seat-a', 'outbox', 'x.tmp')).toBe(true);
    expect(exists('seat-a', 'outbox', 'not-a-stamp.md')).toBe(true);
  });

  it('row 9a — explicit --agent-id override resolves an otherwise-ambiguous repo', () => {
    writeFiles('seat-a', 'outbox', [AGED_4]);
    writeFiles('seat-b', 'outbox', [AGED_2]);

    const result = run({ apply: true, agentId: 'seat-a' });

    expect(result.agent).toBe('seat-a');
    expect(result.pruned).toEqual([AGED_4]);
    expect(exists('seat-b', 'outbox', AGED_2)).toBe(true);
  });

  it('row 9b — env TOTEM_SELF_AGENT single-agent resolves', () => {
    writeFiles('seat-a', 'outbox', [AGED_4]);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.agent).toBe('seat-a');
    expect(result.pruned).toEqual([AGED_4]);
  });

  it('row 10 — missing outbox dir yields a clean empty result, no throw', () => {
    // No outbox created for seat-a at all.
    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.agent).toBe('seat-a');
    expect(result.pruned).toEqual([]);
    expect(result.kept).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.outbox).toBe(path.join(tmpRoot, '.totem', 'orchestration', 'seat-a', 'outbox'));
  });

  it('row 11 — invalid --retain-days (negative / non-integer) is a usage throw', () => {
    writeFiles('seat-a', 'outbox', [AGED_4]);
    expect(() => run({ retainDays: -1, env: { TOTEM_SELF_AGENT: 'seat-a' } })).toThrow(
      /non-negative integer/i,
    );
    expect(() => run({ retainDays: 3.5, env: { TOTEM_SELF_AGENT: 'seat-a' } })).toThrow(
      /non-negative integer/i,
    );
    // NON-VACUITY: the throw is a usage error raised before any scan.
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(true);
  });

  it('row 12 — a partial delete failure is captured; other files still pruned', () => {
    writeFiles('seat-a', 'outbox', [AGED_4, AGED_2]);
    // The mocked unlinkSync throws for AGED_4, passes through for AGED_2.
    fsMockState.failFor.add(AGED_4);

    const result = run({ apply: true, env: { TOTEM_SELF_AGENT: 'seat-a' } });

    expect(result.pruned).toEqual([AGED_2]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.file).toBe(AGED_4);
    expect(result.failed[0]!.error).toMatch(/EPERM/);
    // The failed file remains on disk; the succeeding one is gone.
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(true);
    expect(exists('seat-a', 'outbox', AGED_2)).toBe(false);
  });

  it('retainDays 0 prunes everything strictly before now', () => {
    // With N=0 the cutoff is `now`; a fresh-but-past file becomes prunable.
    writeFiles('seat-a', 'outbox', [FRESH_4]);
    const result = run({ apply: true, retainDays: 0, env: { TOTEM_SELF_AGENT: 'seat-a' } });
    expect(result.cutoffKey).toBe('20260705120000');
    expect(result.pruned).toEqual([FRESH_4]);
  });
});
