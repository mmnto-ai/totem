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

import { type TotemConfig, TotemConfigError, TotemConfigSchema } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import {
  classifyEntry,
  cutoffKey,
  eclCompact,
  type EclCompactOptions,
  eclGc,
  type EclGcOptions,
  loadEclConfig,
  planPrune,
  resolveEclGcExitCode,
  resolveExpectedRoster,
  toStampKey,
} from './ecl-gc.js';

/** Build a real (schema-validated) `TotemConfig` for roster-resolution tests —
 *  optionally with an `ecl.cohortRepos` roster. No casts: exercises the actual
 *  schema so the fixture can never drift from the shipped shape.
 *  `emptyEclBlock` yields the DISTINCT block-present-key-omitted state
 *  (`ecl: {}`) — schema-valid, still undeclared (greptile on PR #2315: the
 *  no-ecl-key and empty-ecl-block states must each be exercised as named). */
function cfg(cohortRepos?: string[], opts?: { emptyEclBlock?: boolean }): TotemConfig {
  return TotemConfigSchema.parse({
    targets: [{ glob: '**/*.md', type: 'spec' as const, strategy: 'markdown-heading' as const }],
    ...(cohortRepos ? { ecl: { cohortRepos } } : opts?.emptyEclBlock === true ? { ecl: {} } : {}),
  });
}

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

// `loadEclConfig` (the config-read seam) is the only path touching `../utils.js`;
// override just its two functions (spread-actual passthrough keeps every other
// utils export real, so the fs-driven prune/compact tests are unaffected). Lets
// the missing-vs-invalid distinction be tested without a real config on disk.
const utilsMock = vi.hoisted(() => ({
  resolveConfigPath: vi.fn(),
  loadConfig: vi.fn(),
}));
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    resolveConfigPath: utilsMock.resolveConfigPath,
    loadConfig: utilsMock.loadConfig,
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
  // Since mmnto-ai/totem#2312 `eclGc`/`eclCompact` derive the repo root by
  // walking UP to the nearest `.totem`/`.git` marker. Plant markers at the two
  // fixture roots (`tmpRoot` for the prune, `<tmpRoot>/totem` for the compact)
  // so the walk anchors there instead of climbing to a host-level ancestor
  // marker (e.g. `~/.totem`) — the same fixture requirement `selfRepoRoot` gained.
  mkDir(path.join(tmpRoot, '.totem'));
  mkDir(path.join(tmpRoot, 'totem', '.totem'));
});

afterEach(() => {
  fsMockState.failFor.clear();
  utilsMock.resolveConfigPath.mockReset();
  utilsMock.loadConfig.mockReset();
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

  it('row 3b — an unsafe resolved agent-id is rejected BEFORE any deletion', () => {
    // resolveSelfSender returns an explicit --agent-id verbatim, so a caller
    // could hand in an id that escapes the `<orchestration>/<agent>/outbox`
    // segment. The isPathSafeAgentId guard must reject it before any scan/delete.
    writeFiles('seat-a', 'outbox', [AGED_4]);

    expect(() => run({ apply: true, agentId: '../seat-a' })).toThrow(/invalid agent-id/i);

    // NON-VACUITY: nothing may be deleted on the guard-throw path.
    expect(exists('seat-a', 'outbox', AGED_4)).toBe(true);
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

// ─── Compaction (ADR-106 § A2 / ecl-discipline § 4.5; mmnto-ai/totem#2307) ───
//
// Compaction runs across a WORKSPACE (not a single repo): `tmpRoot` IS the
// workspace, the compacting seat lives in `<tmpRoot>/totem`, and peer outboxes
// (the raw addressed-inbound) live in `<tmpRoot>/<peerRepo>/…`. The A2.2 gate
// checks that every `expectedRepos` entry is a present directory in the
// workspace, so tests inject an explicit roster and create (or omit) repo dirs
// to drive the abort arms.

const CS = 'totem-agy'; // the compacting seat
const CROSTER = ['totem', 'totem-strategy']; // injected expected roster

// Live/swept dispatch basenames (stamp-shaped so pollMail's self-priority
// bucketing sees them the same way production names are seen).
const DIRECT_LIVE = '2026-07-01T1000Z-totem-agy-alive.md';
const DIRECT_SWEPT = '2026-06-01T0900Z-totem-agy-swept.md';
const BCAST_LIVE = '2026-07-01T1001Z-broadcast-alive.md';
const BCAST_SWEPT = '2026-06-01T0800Z-broadcast-swept.md';

function compactRoot(): string {
  return path.join(tmpRoot, 'totem');
}

function processedPath(agent: string, name: string, broadcast = false): string {
  const dir = broadcast
    ? path.join(compactRoot(), '.totem', 'orchestration', agent, 'processed', '_broadcast')
    : path.join(compactRoot(), '.totem', 'orchestration', agent, 'processed');
  return path.join(dir, name);
}

/** Write a processed MARK for `agent` (direct or broadcast store). */
function writeMark(agent: string, name: string, broadcast = false): void {
  const p = processedPath(agent, name, broadcast);
  mkDir(path.dirname(p));
  fs.writeFileSync(p, 'x', 'utf-8');
}

function markExists(agent: string, name: string, broadcast = false): boolean {
  return fs.existsSync(processedPath(agent, name, broadcast));
}

/** Write an INBOUND dispatch (raw addressed-inbound) in a peer repo's outbox. */
function writeInbound(repo: string, sender: string, name: string, to: string): void {
  const dir = path.join(tmpRoot, repo, '.totem', 'orchestration', sender, 'outbox');
  mkDir(dir);
  fs.writeFileSync(path.join(dir, name), `---\nto: ${to}\nfrom: ${sender}\n---\n\nbody\n`, 'utf-8');
}

/** Ensure each expected roster repo exists as a directory in the workspace. */
function ensureRepos(repos: string[]): void {
  for (const r of repos) mkDir(path.join(tmpRoot, r));
}

function runCompact(opts: Partial<EclCompactOptions> = {}): ReturnType<typeof eclCompact> {
  return eclCompact({
    repoRoot: compactRoot(),
    workspace: tmpRoot,
    env: { TOTEM_SELF_AGENT: CS },
    expectedRepos: CROSTER,
    ...opts,
  });
}

describe('compaction — cursor-coupled GC (A2.1–A2.4)', () => {
  it('C1 — canonical fixture: swept marks collected, live marks retained (direct + broadcast)', () => {
    ensureRepos(CROSTER);
    // Live dispatches still present in a peer outbox (their marks are load-bearing).
    writeInbound('totem-strategy', 'strategy-claude', DIRECT_LIVE, CS);
    writeInbound('totem-strategy', 'strategy-claude', BCAST_LIVE, 'broadcast');
    // Four marks: two live (retain), two swept (collect).
    writeMark(CS, DIRECT_LIVE);
    writeMark(CS, DIRECT_SWEPT);
    writeMark(CS, BCAST_LIVE, true);
    writeMark(CS, BCAST_SWEPT, true);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    expect(r.collected.sort()).toEqual([BCAST_SWEPT, DIRECT_SWEPT].sort());
    // Live marks survive; swept marks gone.
    expect(markExists(CS, DIRECT_LIVE)).toBe(true);
    expect(markExists(CS, BCAST_LIVE, true)).toBe(true);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(false);
    expect(markExists(CS, BCAST_SWEPT, true)).toBe(false);
    // A2.4: nothing previously-handled re-surfaces.
    expect(r.resurfaced).toEqual([]);
  });

  it('C2 — A2.1 inversion RED test: a live mark is RETAINED (naive pollMail().mail would delete it)', () => {
    ensureRepos(CROSTER);
    // The dispatch is present AND marked handled — so `pollMail().mail` (which
    // subtracts processed) reports it ABSENT. A naive impl keyed on that list
    // would collect the mark and the dispatch would re-surface on re-poll. The
    // raw-addressed-inbound scan (includeProcessed) keeps it in view.
    writeInbound('totem-strategy', 'strategy-claude', DIRECT_LIVE, CS);
    writeMark(CS, DIRECT_LIVE);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([]); // NON-VACUITY: naive impl deletes this mark
    expect(markExists(CS, DIRECT_LIVE)).toBe(true);
    expect(r.resurfaced).toEqual([]); // naive impl trips this
  });

  it('C3 — abort arm: a missing expected repo blocks all deletes (N < M)', () => {
    // Only `totem` present; `totem-strategy` (in the roster) is absent.
    ensureRepos(['totem']);
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(false);
    expect(r.gateReasons.some((x) => /missing.*totem-strategy/.test(x))).toBe(true);
    expect(r.collected).toEqual([]);
    // NON-VACUITY: uncertain ⇒ retain — the swept mark survives an incomplete poll.
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });

  it('C4 — abort arm: any scan/parse warning blocks all deletes', () => {
    ensureRepos(CROSTER);
    // A mail-shaped dispatch with no closing delimiter → pollMail parse warning.
    const dir = path.join(
      tmpRoot,
      'totem-strategy',
      '.totem',
      'orchestration',
      'strategy-claude',
      'outbox',
    );
    mkDir(dir);
    fs.writeFileSync(
      path.join(dir, '2026-07-01T1200Z-totem-agy-malformed.md'),
      '---\nto: totem-agy\nno closing',
      'utf-8',
    );
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.collected).toEqual([]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });

  it('C5 — abort arm: scan truncation blocks all deletes', () => {
    ensureRepos(CROSTER);
    // 3 addressed dispatches, maxScan 2 → pollMail truncates → gate red.
    writeInbound('totem-strategy', 'strategy-claude', DIRECT_LIVE, CS);
    writeInbound('totem-strategy', 'strategy-claude', '2026-07-01T1002Z-totem-agy-b.md', CS);
    writeInbound('totem-strategy', 'strategy-claude', '2026-07-01T1003Z-totem-agy-c.md', CS);
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact({ apply: true, maxScan: 2 });

    expect(r.gateComplete).toBe(false);
    expect(r.gateReasons.some((x) => /truncat/i.test(x))).toBe(true);
    expect(r.collected).toEqual([]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });

  it('C6 — self-seat ambiguity THROWS before any scan/delete (usage, exit-2 class)', () => {
    ensureRepos(CROSTER);
    // Two seat dirs registered, no TOTEM_SELF_AGENT, no --agent-id → ambiguous.
    writeMark('totem-agy', DIRECT_SWEPT);
    writeMark('totem-claude', DIRECT_SWEPT);

    expect(() =>
      eclCompact({ repoRoot: compactRoot(), workspace: tmpRoot, env: {}, expectedRepos: CROSTER }),
    ).toThrow(/cannot resolve a single agent/i);

    // NON-VACUITY: nothing deleted on the throwing path.
    expect(markExists('totem-agy', DIRECT_SWEPT)).toBe(true);
    expect(markExists('totem-claude', DIRECT_SWEPT)).toBe(true);
  });

  it('C7 — multi-seat isolation: compacting seat S never touches a peer seat’s processed/', () => {
    ensureRepos(CROSTER);
    // Same swept basename marked by BOTH seats; only S=totem-agy is targeted.
    writeMark('totem-agy', DIRECT_SWEPT);
    writeMark('totem-claude', DIRECT_SWEPT);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([DIRECT_SWEPT]);
    expect(markExists('totem-agy', DIRECT_SWEPT)).toBe(false);
    // NON-VACUITY: a coordinator-union target would delete the peer's mark too.
    expect(markExists('totem-claude', DIRECT_SWEPT)).toBe(true);
  });

  it('C8 — dry-run lists would-collect but deletes nothing', () => {
    ensureRepos(CROSTER);
    writeInbound('totem-strategy', 'strategy-claude', DIRECT_LIVE, CS);
    writeMark(CS, DIRECT_LIVE);
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact(); // dry-run (no --apply)

    expect(r.dryRun).toBe(true);
    expect(r.gateComplete).toBe(true);
    expect(r.collectable).toEqual([DIRECT_SWEPT]);
    expect(r.collected).toEqual([]);
    // `retained` reflects the WOULD-survive count in dry-run (marks − collectable),
    // consistent with the display + apply semantics (greptile).
    expect(r.marks).toBe(2);
    expect(r.retained).toBe(1);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true); // nothing deleted
  });

  it('C9 — union retention: a direct mark is retained by a live BROADCAST of the same basename', () => {
    ensureRepos(CROSTER);
    // Only a broadcast dispatch exists for this basename; the mark sits in the
    // DIRECT store. pollMail's processed filter is recipient-class-blind, so the
    // mark shadows the live broadcast dispatch — union retention keeps it.
    writeInbound('totem-strategy', 'strategy-claude', BCAST_LIVE, 'broadcast');
    writeMark(CS, BCAST_LIVE); // DIRECT store, matched by broadcast inbound

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([]);
    expect(markExists(CS, BCAST_LIVE)).toBe(true);
  });

  it('C10 — other-recipient same basename does NOT retain a self mark (filter is parsed to:, not basename)', () => {
    ensureRepos(CROSTER);
    // A dispatch of this basename exists but is addressed to a DIFFERENT seat, so
    // it is not part of S's addressed-inbound; the mark is inert → collected.
    writeInbound('totem-strategy', 'strategy-claude', DIRECT_SWEPT, 'totem-gemini');
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([DIRECT_SWEPT]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(false);
  });

  it('C11 — a partial mark-delete failure is captured; other marks still collected', () => {
    ensureRepos(CROSTER);
    writeMark(CS, DIRECT_SWEPT);
    writeMark(CS, BCAST_SWEPT, true);
    // Mock unlinkSync to fail the direct swept mark, pass the broadcast one.
    fsMockState.failFor.add(DIRECT_SWEPT);

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([BCAST_SWEPT]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.error).toMatch(/EPERM/);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true); // failed delete → mark remains
    expect(markExists(CS, BCAST_SWEPT, true)).toBe(false);
  });

  it('C12 — undeclared (empty) roster HARD-ABORTS (exit 3), never "assume complete" (strategy#828)', () => {
    ensureRepos(CROSTER);
    writeMark(CS, DIRECT_SWEPT); // a genuinely inert mark that WOULD be collectable

    const r = runCompact({ apply: true, expectedRepos: [] });

    expect(r.rosterDeclared).toBe(false);
    // Folded into the A2.2 gate: no declared roster => gate red => hard-abort (exit 3),
    // fail-loud (never a silent no-op) per the strategy#828 no-roster corollary.
    expect(r.gateComplete).toBe(false);
    expect(r.gateReasons.some((x) => /no cohort roster declared/.test(x))).toBe(true);
    expect(resolveEclGcExitCode({ failed: [] }, r)).toBe(3);
    expect(r.collected).toEqual([]);
    // NON-VACUITY: with no declared roster, completeness is unprovable, so even a
    // truly-inert mark is retained rather than deleted on an assumed-complete scan.
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
    expect(r.marks).toBe(1); // still reports the seat's mark count
  });

  it('C13 — --force-incomplete waives the missing-repo abort; deletes proceed', () => {
    // Only `totem` present; `totem-strategy` (in the roster) absent → normally aborts.
    ensureRepos(['totem']);
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact({ apply: true, forceIncomplete: true });

    // Roster arm waived → gate green; the missing repo is still surfaced (loud).
    expect(r.gateComplete).toBe(true);
    expect(r.gateReasons.some((x) => /missing.*totem-strategy/.test(x))).toBe(true);
    expect(r.collected).toEqual([DIRECT_SWEPT]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(false);
  });

  it('C13b — --force-incomplete does NOT waive a scan warning (broken read still aborts)', () => {
    ensureRepos(CROSTER);
    const dir = path.join(
      tmpRoot,
      'totem-strategy',
      '.totem',
      'orchestration',
      'strategy-claude',
      'outbox',
    );
    mkDir(dir);
    fs.writeFileSync(
      path.join(dir, '2026-07-01T1200Z-totem-agy-malformed.md'),
      '---\nto: totem-agy\nno closing',
      'utf-8',
    );
    writeMark(CS, DIRECT_SWEPT);

    const r = runCompact({ apply: true, forceIncomplete: true });

    // Force waives roster presence only — a parse warning is still a hard abort.
    expect(r.gateComplete).toBe(false);
    expect(r.collected).toEqual([]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });

  it('C14 — dual-store same basename, one arm fails: not collected (no collected/failed overlap), retained accurate', () => {
    ensureRepos(CROSTER);
    const DUAL = DIRECT_SWEPT; // same basename inert in BOTH stores
    writeMark(CS, DUAL); // direct
    writeMark(CS, DUAL, true); // broadcast
    // Fail ONLY the broadcast arm's unlink (platform-safe path suffix match).
    fsMockState.failFor.add(path.join('_broadcast', DUAL));

    const r = runCompact({ apply: true });

    expect(r.gateComplete).toBe(true);
    // Direct arm deleted but broadcast arm failed → NOT fully collected; the
    // basename lands in `failed`, never in `collected` (no overlap — greptile).
    expect(r.collected).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.file).toBe(`_broadcast/${DUAL}`);
    // `retained` counts the still-on-disk broadcast mark (marks=1 basename, collected=0).
    expect(r.marks).toBe(1);
    expect(r.retained).toBe(1);
    expect(markExists(CS, DUAL)).toBe(false); // direct arm gone
    expect(markExists(CS, DUAL, true)).toBe(true); // broadcast arm remains
  });

  it('C15 — an unscannable roster name (dot/node_modules) hard-aborts, NOT waivable by --force-incomplete', () => {
    ensureRepos(['totem', 'totem-strategy']);
    writeMark(CS, DIRECT_SWEPT);
    // A declared roster entry the workspace scan would filter out (starts with
    // '.') — the gate must abort even under --force-incomplete: it is a config
    // error (unscannable), not a known-absent repo (CodeRabbit).
    const r = runCompact({
      apply: true,
      expectedRepos: ['totem', 'totem-strategy', '.evil'],
      forceIncomplete: true,
    });

    expect(r.gateComplete).toBe(false);
    expect(r.gateReasons.some((x) => /unscannable/.test(x))).toBe(true);
    expect(r.collected).toEqual([]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });

  it('C16 — config.ecl.cohortRepos drives the roster when expectedRepos is absent (mmnto-ai/totem#2310)', () => {
    ensureRepos(CROSTER);
    writeInbound('totem-strategy', 'strategy-claude', DIRECT_LIVE, CS);
    writeMark(CS, DIRECT_LIVE);
    writeMark(CS, DIRECT_SWEPT);

    // No `expectedRepos` → the injected config roster reaches the A2.2 gate.
    const r = eclCompact({
      repoRoot: compactRoot(),
      workspace: tmpRoot,
      env: { TOTEM_SELF_AGENT: CS },
      config: cfg(CROSTER),
      apply: true,
    });

    expect(r.expectedRepos).toEqual([...CROSTER].sort());
    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([DIRECT_SWEPT]);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(false);
    expect(markExists(CS, DIRECT_LIVE)).toBe(true);
  });

  it('C17 — explicit expectedRepos WINS over config.ecl.cohortRepos (precedence)', () => {
    ensureRepos(CROSTER); // only the explicit roster's repos are present
    writeMark(CS, DIRECT_SWEPT);

    // Config declares an EXTRA repo that is absent from the workspace — if config
    // won, the gate would go RED (missing repo). Explicit CROSTER (all present)
    // must win → gate green.
    const r = eclCompact({
      repoRoot: compactRoot(),
      workspace: tmpRoot,
      env: { TOTEM_SELF_AGENT: CS },
      expectedRepos: CROSTER,
      config: cfg([...CROSTER, 'totem-absent']),
      apply: true,
    });

    expect(r.expectedRepos).toEqual([...CROSTER].sort());
    // NON-VACUITY: had the config roster been used, `totem-absent` would gate-red.
    expect(r.gateComplete).toBe(true);
    expect(r.collected).toEqual([DIRECT_SWEPT]);
  });

  it('C18 — no expectedRepos AND no config ⇒ undeclared hard-abort (exit-3 arm)', () => {
    ensureRepos(CROSTER);
    writeMark(CS, DIRECT_SWEPT);

    // Neither source declared → the `?? []` fallback lands in the undeclared
    // gate-red arm (parity with C12's explicit `expectedRepos: []`).
    const r = eclCompact({
      repoRoot: compactRoot(),
      workspace: tmpRoot,
      env: { TOTEM_SELF_AGENT: CS },
      apply: true,
    });

    expect(r.expectedRepos).toEqual([]);
    expect(r.rosterDeclared).toBe(false);
    expect(r.gateComplete).toBe(false);
    expect(r.gateReasons.some((x) => /no cohort roster declared/.test(x))).toBe(true);
    expect(resolveEclGcExitCode({ failed: [] }, r)).toBe(3);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });

  it('C19 — an ecl block without cohortRepos is undeclared (config present, key omitted)', () => {
    ensureRepos(CROSTER);
    writeMark(CS, DIRECT_SWEPT);

    // The NAMED state: a schema-valid `ecl: {}` block with `cohortRepos`
    // omitted → still undeclared → hard-abort. (The no-`ecl`-key-at-all state
    // is a resolveExpectedRoster unit row; C18 covers no config object.)
    const r = eclCompact({
      repoRoot: compactRoot(),
      workspace: tmpRoot,
      env: { TOTEM_SELF_AGENT: CS },
      config: cfg(undefined, { emptyEclBlock: true }),
      apply: true,
    });

    expect(r.gateComplete).toBe(false);
    expect(r.gateReasons.some((x) => /no cohort roster declared/.test(x))).toBe(true);
    expect(markExists(CS, DIRECT_SWEPT)).toBe(true);
  });
});

// ─── Roster resolution precedence (mmnto-ai/totem#2310) ──

describe('resolveExpectedRoster — explicit > config > undefined', () => {
  it('explicit expectedRepos wins over config', () => {
    expect(resolveExpectedRoster(['a', 'b'], cfg(['c', 'd']))).toEqual(['a', 'b']);
  });
  it('config.ecl.cohortRepos is used when explicit is absent', () => {
    expect(resolveExpectedRoster(undefined, cfg(['c', 'd']))).toEqual(['c', 'd']);
  });
  it('undefined when a config has no ecl block', () => {
    expect(resolveExpectedRoster(undefined, cfg())).toBeUndefined();
  });
  it('undefined when the ecl block is present but cohortRepos is omitted', () => {
    expect(
      resolveExpectedRoster(undefined, cfg(undefined, { emptyEclBlock: true })),
    ).toBeUndefined();
  });
  it('undefined when neither source is present', () => {
    expect(resolveExpectedRoster(undefined, undefined)).toBeUndefined();
  });
  it('explicit wins even over an undefined-roster config', () => {
    expect(resolveExpectedRoster(['a'], cfg())).toEqual(['a']);
  });
});

// ─── Config-read seam: loadEclConfig (mmnto-ai/totem#2310) ──

describe('loadEclConfig — missing ⇒ undeclared, invalid ⇒ loud', () => {
  it('returns undefined when NO config file exists (honest undeclared → gate-red)', async () => {
    utilsMock.resolveConfigPath.mockImplementation(() => {
      throw new TotemConfigError(
        'No Totem configuration found.',
        'run totem init',
        'CONFIG_MISSING',
      );
    });

    await expect(loadEclConfig('/nowhere')).resolves.toBeUndefined();
    expect(utilsMock.loadConfig).not.toHaveBeenCalled();
  });

  it('RETHROWS a present-but-invalid config LOUD (never degraded to undeclared)', async () => {
    // The empty-roster / any Zod failure path: loadConfig throws CONFIG_INVALID.
    utilsMock.resolveConfigPath.mockReturnValue('/repo/totem.config.ts');
    utilsMock.loadConfig.mockRejectedValue(
      new TotemConfigError(
        'Invalid configuration:\n  ecl.cohortRepos: Array must contain at least 1 element(s)',
        'fix the fields listed above',
        'CONFIG_INVALID',
      ),
    );

    // NON-VACUITY: a catch-and-degrade (orient's pattern) would resolve undefined
    // here, aliasing a config bug into the undeclared arm — this asserts it does NOT.
    await expect(loadEclConfig('/repo')).rejects.toThrow(/Invalid configuration/);
  });

  it('returns the loaded config when present and valid', async () => {
    const loaded = cfg(CROSTER);
    utilsMock.resolveConfigPath.mockReturnValue('/repo/totem.config.ts');
    utilsMock.loadConfig.mockResolvedValue(loaded);

    await expect(loadEclConfig('/repo')).resolves.toBe(loaded);
  });
});

// ─── Combined exit-code precedence (codex panel) ────────

describe('resolveEclGcExitCode — combined prune+compact precedence', () => {
  const clean = { failed: [] };
  const partial = { failed: [{ file: 'x', error: 'EPERM' }] };
  const base = {
    rosterDeclared: true,
    gateComplete: true,
    resurfaced: [] as string[],
    verifyComplete: true,
  };
  const gateGreen = { ...base, failed: [] };
  const gateRed = { ...base, gateComplete: false, failed: [] };
  const noRoster = { ...base, rosterDeclared: false, gateComplete: false, failed: [] };
  const resurfaced = { ...base, resurfaced: ['x.md'], failed: [] };
  const verifyUntrusted = { ...base, verifyComplete: false, failed: [] };
  const compactPartial = { ...base, failed: [{ file: 'm', error: 'EPERM' }] };

  it('0 — clean prune, no compaction', () => {
    expect(resolveEclGcExitCode(clean)).toBe(0);
  });
  it('0 — clean prune + green compaction', () => {
    expect(resolveEclGcExitCode(clean, gateGreen)).toBe(0);
  });
  it('3 — undeclared roster HARD-ABORTS (fail-loud, not a silent no-op) — strategy#828', () => {
    expect(resolveEclGcExitCode(clean, noRoster)).toBe(3);
  });
  it('1 — prune partial delete failure, no compaction', () => {
    expect(resolveEclGcExitCode(partial)).toBe(1);
  });
  it('1 — prune clean + compaction partial delete failure', () => {
    expect(resolveEclGcExitCode(clean, compactPartial)).toBe(1);
  });
  it('3 — undeclared-roster hard-abort outranks a prune partial failure (3 > 1)', () => {
    expect(resolveEclGcExitCode(partial, noRoster)).toBe(3);
  });
  it('3 — compaction gate red (declared roster incomplete) outranks a clean prune', () => {
    expect(resolveEclGcExitCode(clean, gateRed)).toBe(3);
  });
  it('3 — compaction A2.4 falsifier tripped', () => {
    expect(resolveEclGcExitCode(clean, resurfaced)).toBe(3);
  });
  it('3 — compaction A2.4 re-poll untrustworthy (truncated/warned verify)', () => {
    expect(resolveEclGcExitCode(clean, verifyUntrusted)).toBe(3);
  });
  it('3 — prune partial + compaction abort: 3 outranks 1', () => {
    expect(resolveEclGcExitCode(partial, gateRed)).toBe(3);
  });
});
