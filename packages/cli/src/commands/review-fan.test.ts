import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeLineageKey,
  findLatestVerdictForLineage,
  listVerdictArtifacts,
  type RunArtifact,
  type TotemConfig,
} from '@mmnto/totem';

import { EMPTY_SHARED } from '../exemptions/exemption-schema.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  assembleVerdict,
  buildDiffScope,
  computeCacheEligible,
  computeSettled,
  type DiffScopeMeta,
  type GitExec,
  type LaneInvocation,
  type LaneInvoker,
  type LaneRunResult,
  resolveLineage,
  type ReviewFanContext,
  runLane,
  runReviewFan,
  validateReviewLanes,
} from './review-fan.js';
import { MAX_DIFF_CHARS, type ShieldFinding } from './shield-templates.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const hex = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const wrapVerdict = (findings: ShieldFinding[], summary = 's'): string =>
  `<shield_verdict>${JSON.stringify({ findings, summary })}</shield_verdict>`;

interface MakeArtifactOpts {
  content: string;
  provider?: string;
  model?: string;
  badProvenance?: boolean;
}

/** Build a schema-valid RunArtifact (the panel re-parses these, so it must pass). */
function makeRunArtifact(opts: MakeArtifactOpts): RunArtifact {
  const provider = opts.provider ?? 'anthropic';
  const model = opts.model ?? 'claude-x';
  const artifact: RunArtifact = {
    schemaVersion: '1.1.0',
    inputBundle: { maskedPrompt: 'prompt' },
    inputHash: hex(`input-${provider}-${model}`),
    grounding: opts.badProvenance
      ? {
          hash: hex('g'),
          provenanceSummary: 'made-up-class:1',
          bundle: {
            items: [
              {
                provenance: 'made-up-class',
                contentHash: hex('citem'),
                sourceType: 'code',
                filePath: 'x.ts',
              },
            ],
          },
        }
      : { hash: hex('g'), provenanceSummary: 'ungrounded' },
    backend: {
      provider,
      model,
      qualifiedModel: `${provider}:${model}`,
      admissionClass: 'completion_only',
      taskProfile: 'Shield',
    },
    output: { content: opts.content, metrics: { durationMs: 1 } },
    admission: { runMetadata: { caller: 'review' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  };
  return artifact;
}

/** A LaneInvocation for a completed lane whose output = the artifact content. */
function completedInvocation(opts: MakeArtifactOpts & { seed: string }): LaneInvocation {
  return {
    content: opts.content,
    runArtifactHash: hex(opts.seed),
    runArtifact: makeRunArtifact(opts),
  };
}

/** An invoker driven by a laneModel → LaneInvocation map. */
function mapInvoker(
  map: Record<string, LaneInvocation | (() => Promise<LaneInvocation>)>,
): LaneInvoker {
  return async (laneModel) => {
    const entry = map[laneModel];
    if (entry === undefined) throw new Error(`no invocation configured for lane ${laneModel}`);
    return typeof entry === 'function' ? entry() : entry;
  };
}

// A stable fake worktree toplevel; `resolveLineage` runs `path.resolve` on it, so
// the lineage-key predictor below must resolve the same string identically.
const REPO_TOPLEVEL = process.platform === 'win32' ? 'C:/fake/worktree' : '/fake/worktree';
const RESOLVED_REPO = path.resolve(REPO_TOPLEVEL);

function fakeGit(branch: string, mergeBase: string): GitExec {
  return (args) => {
    if (args[0] === 'symbolic-ref') return branch;
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return REPO_TOPLEVEL;
    if (args[0] === 'rev-parse') return 'deadbeefdeadbeef';
    if (args[0] === 'merge-base') return mergeBase;
    return '';
  };
}

const MINIMAL_CONFIG = {
  totemDir: '.totem',
  review: { sourceExtensions: ['.ts'] },
} as unknown as TotemConfig;

/** Build a ReviewFanContext for an end-to-end fan run over a temp totem dir. */
function makeCtx(
  totemDirAbs: string,
  laneModels: string[],
  invoker: LaneInvoker,
  overrides: Partial<ReviewFanContext> = {},
): ReviewFanContext {
  return {
    laneModels,
    prompt: 'assembled prompt',
    filteredDiff: 'diff --git a/x.ts b/x.ts\n+const x = 1;\n',
    diffMeta: { source: 'branch-vs-base', base: 'main' },
    config: MINIMAL_CONFIG,
    cwd: totemDirAbs,
    configRoot: totemDirAbs,
    totemDirAbs,
    options: {},
    groundingHash: hex('gh'),
    provenanceSummary: 'ungrounded',
    groundingBundle: { items: [] },
    totalResults: 0,
    codeBlind: false,
    shared: EMPTY_SHARED,
    preFanContentHash: null,
    invoker,
    gitExec: fakeGit('feature-x', 'basesha'),
    now: () => new Date().toISOString(),
    // Default the post-fan content hash to null (matches the null preFanContentHash
    // ⇒ reviewedState='matched') so the fan never spawns real git in a temp dir.
    // Gate 1 overrides this to simulate a mid-fan tree mutation.
    contentHash: async () => null,
    ...overrides,
  };
}

// ─── validateReviewLanes (config validator) ──────────────────────────────────

describe('validateReviewLanes', () => {
  it('accepts and normalizes known provider:model lanes', () => {
    const out = validateReviewLanes(['anthropic:claude-x', 'gemini:gemini-2.5'], 'anthropic');
    expect(out).toEqual(['anthropic:claude-x', 'gemini:gemini-2.5']);
  });

  it('resolves a bare lane against the base provider', () => {
    const out = validateReviewLanes(['claude-x'], 'anthropic');
    expect(out).toEqual(['anthropic:claude-x']);
  });

  it('returns [] for absent lanes (legacy path)', () => {
    expect(validateReviewLanes(undefined, 'anthropic')).toEqual([]);
  });

  it('rejects the shell provider', () => {
    expect(() => validateReviewLanes(['shell:echo'], 'anthropic')).toThrow(/shell/);
  });

  it('rejects duplicate normalized lanes', () => {
    expect(() =>
      validateReviewLanes(['anthropic:claude-x', 'anthropic:claude-x'], 'anthropic'),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown provider prefix', () => {
    expect(() => validateReviewLanes(['weirdvendor:some-model'], 'anthropic')).toThrow(
      /unknown provider/,
    );
  });

  it('rejects empty / whitespace-only entries', () => {
    expect(() => validateReviewLanes(['  '], 'anthropic')).toThrow(/empty/);
  });

  it('rejects a bare lane when no base provider is configured', () => {
    expect(() => validateReviewLanes(['claude-x'], undefined)).toThrow(/no orchestrator provider/);
  });
});

// ─── Predicates (pure — gate 6 + gate 8) ─────────────────────────────────────

describe('computeSettled / computeCacheEligible', () => {
  const completedLane = (id: string): LaneRunResult['lane'] => ({
    status: 'completed',
    laneId: id,
    resolvedBackend: 'anthropic:claude-x',
    runArtifactHash: hex(id),
    verdictSummary: { critical: 0, warn: 0, info: 0 },
  });
  const failedLane = (id: string): LaneRunResult['lane'] => ({
    status: 'failed',
    laneId: id,
    typedReason: 'invoke-error',
  });
  const warn: ShieldFinding = { severity: 'WARN', confidence: 0.6, message: 'w' };
  const critical: ShieldFinding = { severity: 'CRITICAL', confidence: 0.9, message: 'c' };

  it('a dry round settles and is cache-eligible', () => {
    const inputs = {
      lanes: [completedLane('a'), completedLane('b')],
      findingsUnion: [],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(computeSettled(inputs)).toBe(true);
    expect(computeCacheEligible(inputs)).toBe(true);
  });

  it('a WARN blocks settled but NOT cache-eligibility (WARN-drip class)', () => {
    const inputs = {
      lanes: [completedLane('a')],
      findingsUnion: [warn],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(computeSettled(inputs)).toBe(false);
    expect(computeCacheEligible(inputs)).toBe(true);
  });

  it('a CRITICAL blocks BOTH settled and cache-eligibility', () => {
    const inputs = {
      lanes: [completedLane('a')],
      findingsUnion: [critical],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(computeSettled(inputs)).toBe(false);
    expect(computeCacheEligible(inputs)).toBe(false);
  });

  it('a failed lane blocks BOTH (lane coverage conjunct)', () => {
    const inputs = {
      lanes: [completedLane('a'), failedLane('b')],
      findingsUnion: [],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(computeSettled(inputs)).toBe(false);
    expect(computeCacheEligible(inputs)).toBe(false);
  });

  it("reviewedState 'drifted' blocks BOTH even on an otherwise-dry round (codex rev-2 fold 1)", () => {
    const inputs = {
      lanes: [completedLane('a'), completedLane('b')],
      findingsUnion: [],
      postChecks: [],
      reviewedState: 'drifted' as const,
    };
    expect(computeSettled(inputs)).toBe(false);
    expect(computeCacheEligible(inputs)).toBe(false);
  });

  it('a decidable-tier post-check fail gates BOTH; a sensor-tier fail gates NEITHER (gate 8)', () => {
    const base = {
      lanes: [completedLane('a')],
      findingsUnion: [],
      reviewedState: 'matched' as const,
    };
    const sensorFail = {
      ...base,
      postChecks: [
        {
          ruleName: 'provenance-fail-safe-down',
          tier: 'sensor' as const,
          verdict: 'fail' as const,
          message: 'x',
        },
      ],
    };
    expect(computeSettled(sensorFail)).toBe(true);
    expect(computeCacheEligible(sensorFail)).toBe(true);

    const decidableFail = {
      ...base,
      postChecks: [
        {
          ruleName: 'review-structured-verdict',
          tier: 'decidable' as const,
          verdict: 'fail' as const,
          message: 'x',
        },
      ],
    };
    expect(computeSettled(decidableFail)).toBe(false);
    expect(computeCacheEligible(decidableFail)).toBe(false);
  });
});

// ─── runLane (per-lane classification — gate 2 + gate 3) ──────────────────────

describe('runLane', () => {
  it('a response-cache/missing-emission lane fails (no completed lane without an artifact)', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-x': {
        content: wrapVerdict([]),
        runArtifactHash: undefined,
        runArtifact: undefined,
      },
    });
    const result = await runLane('anthropic:claude-x', invoker, EMPTY_SHARED, 'delivered-prompt');
    expect(result.lane.status).toBe('failed');
    if (result.lane.status === 'failed') {
      expect(result.lane.typedReason).toBe('missing-artifact-emission');
    }
  });

  it('malformed lane output abstains (never a completed lane)', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-x': completedInvocation({ content: 'not a verdict at all', seed: 'l1' }),
    });
    const result = await runLane('anthropic:claude-x', invoker, EMPTY_SHARED, 'delivered-prompt');
    expect(result.lane.status).toBe('abstained');
  });

  it('an extractable verdict completes with an honest severity tally', async () => {
    const content = wrapVerdict([
      { severity: 'CRITICAL', confidence: 0.9, message: 'c' },
      { severity: 'WARN', confidence: 0.6, message: 'w' },
    ]);
    const invoker = mapInvoker({
      'anthropic:claude-x': completedInvocation({ content, seed: 'l2' }),
    });
    const result = await runLane('anthropic:claude-x', invoker, EMPTY_SHARED, 'delivered-prompt');
    expect(result.lane.status).toBe('completed');
    if (result.lane.status === 'completed') {
      expect(result.lane.verdictSummary).toEqual({ critical: 1, warn: 1, info: 0 });
      expect(result.lane.resolvedBackend).toBe('anthropic:claude-x');
    }
    expect(result.filteredFindings).toHaveLength(2);
  });

  it('a quota throw is classified failed quota-exhausted', async () => {
    const invoker: LaneInvoker = async () => {
      throw new Error('Quota exhausted for anthropic:claude-x.');
    };
    const result = await runLane('anthropic:claude-x', invoker, EMPTY_SHARED, 'delivered-prompt');
    expect(result.lane.status).toBe('failed');
    if (result.lane.status === 'failed') expect(result.lane.typedReason).toBe('quota-exhausted');
  });

  it('a generic invoke throw is classified failed invoke-error', async () => {
    const invoker: LaneInvoker = async () => {
      throw new Error('socket hang up');
    };
    const result = await runLane('anthropic:claude-x', invoker, EMPTY_SHARED, 'delivered-prompt');
    expect(result.lane.status).toBe('failed');
    if (result.lane.status === 'failed') expect(result.lane.typedReason).toBe('invoke-error');
  });
});

// ─── Diff scope + lineage ─────────────────────────────────────────────────────

describe('buildDiffScope', () => {
  it('records both endpoints for explicit-range, defaulting a bare head to HEAD', () => {
    expect(buildDiffScope({ source: 'explicit-range', base: 'HEAD^' }, hex('d'))).toEqual({
      source: 'explicit-range',
      diffHash: hex('d'),
      base: 'HEAD^',
      head: 'HEAD',
    });
  });
  it('records base only for branch-vs-base', () => {
    expect(buildDiffScope({ source: 'branch-vs-base', base: 'main' }, hex('d'))).toEqual({
      source: 'branch-vs-base',
      diffHash: hex('d'),
      base: 'main',
    });
  });
  it('records no refs for staged / uncommitted', () => {
    expect(buildDiffScope({ source: 'staged' }, hex('d'))).toEqual({
      source: 'staged',
      diffHash: hex('d'),
    });
    expect(buildDiffScope({ source: 'uncommitted' }, hex('d'))).toEqual({
      source: 'uncommitted',
      diffHash: hex('d'),
    });
  });
});

describe('resolveLineage (gate 6)', () => {
  it('two branches sharing base=main produce DISTINCT lineage keys', async () => {
    const meta: DiffScopeMeta = { source: 'branch-vs-base', base: 'main' };
    const a = await resolveLineage(meta, fakeGit('feature-a', 'sharedbase'));
    const b = await resolveLineage(meta, fakeGit('feature-b', 'sharedbase'));
    expect(a.lineageKey).not.toBe(b.lineageKey);
    // Sanity: the same branch + base + source is stable.
    const a2 = await resolveLineage(meta, fakeGit('feature-a', 'sharedbase'));
    expect(a.lineageKey).toBe(a2.lineageKey);
  });

  it('two different explicit ranges on one branch + merge-base produce DISTINCT keys (codex rev-2 gate 2)', async () => {
    const git = fakeGit('feature-x', 'sharedbase');
    const a = await resolveLineage({ source: 'explicit-range', base: 'HEAD~3', head: 'HEAD' }, git);
    const b = await resolveLineage({ source: 'explicit-range', base: 'HEAD~5', head: 'HEAD' }, git);
    expect(a.lineageKey).not.toBe(b.lineageKey);
    // Sanity: the same range on the same branch is stable.
    const a2 = await resolveLineage(
      { source: 'explicit-range', base: 'HEAD~3', head: 'HEAD' },
      git,
    );
    expect(a.lineageKey).toBe(a2.lineageKey);
  });

  it('staged/uncommitted use an empty merge-base (branch + source carry lineage)', async () => {
    const res = await resolveLineage({ source: 'staged' }, fakeGit('feature-a', 'unused'));
    expect(res.mergeBase).toBe('');
    expect(res.branch).toBe('feature-a');
  });

  it('a detached HEAD becomes a DETACHED:<sha> literal', async () => {
    const git: GitExec = (args) => {
      if (args[0] === 'symbolic-ref') throw new Error('detached');
      if (args[0] === 'rev-parse') return 'abc123';
      return '';
    };
    const res = await resolveLineage({ source: 'uncommitted' }, git);
    expect(res.branch).toBe('DETACHED:abc123');
  });
});

// ─── assembleVerdict (structure) ──────────────────────────────────────────────

describe('assembleVerdict', () => {
  const lane = (id: string, findings: ShieldFinding[]): LaneRunResult => ({
    lane: {
      status: 'completed',
      laneId: id,
      resolvedBackend: 'anthropic:claude-x',
      runArtifactHash: hex(id),
      verdictSummary: {
        critical: findings.filter((f) => f.severity === 'CRITICAL').length,
        warn: findings.filter((f) => f.severity === 'WARN').length,
        info: findings.filter((f) => f.severity === 'INFO').length,
      },
    },
    runArtifact: makeRunArtifact({ content: wrapVerdict(findings) }),
    filteredFindings: findings,
  });

  it('derives counts and settled from artifact content, never mirrored on trust', () => {
    const verdict = assembleVerdict({
      diffScope: { source: 'staged', diffHash: hex('d') },
      laneResults: [lane('a', []), lane('b', [])],
      panelAndChecks: { postChecks: [] },
      round: { index: 0, lineageKey: 'lk' },
      reviewedState: 'matched',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    expect(verdict.attemptedLaneCount).toBe(2);
    expect(verdict.completedLaneCount).toBe(2);
    expect(verdict.reviewedState).toBe('matched');
    expect(verdict.settled).toBe(true);
    expect(verdict.panelArtifactHash).toBeUndefined();
  });

  it("records reviewedState='drifted' and forces settled=false on an otherwise-dry fan", () => {
    const verdict = assembleVerdict({
      diffScope: { source: 'staged', diffHash: hex('d') },
      laneResults: [lane('a', []), lane('b', [])],
      panelAndChecks: { postChecks: [] },
      round: { index: 0, lineageKey: 'lk' },
      reviewedState: 'drifted',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    expect(verdict.reviewedState).toBe('drifted');
    expect(verdict.settled).toBe(false);
  });
});

// ─── runReviewFan (end-to-end — gates 4, 5, 7 wiring) ─────────────────────────

describe('runReviewFan', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-fan-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  // Predict the composite lineage key `resolveLineage` computes for a makeCtx fan:
  // repoIdentity = resolved fake toplevel; branch-vs-base contributes base='main'
  // (the makeCtx diffMeta base) + the resolved merge-base.
  const lineageKeyFor = (branch: string, mergeBase: string, source: DiffScopeMeta['source']) =>
    computeLineageKey(
      source === 'branch-vs-base'
        ? { repoIdentity: RESOLVED_REPO, branch, source, base: 'main', mergeBase }
        : { repoIdentity: RESOLVED_REPO, branch, source },
    );

  it('one failed + one passing lane: honest counts, verdict written, NO panel, not cache-eligible → SHIELD_FAILED', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: wrapVerdict([]),
        provider: 'anthropic',
        model: 'claude-a',
        seed: 'a',
      }),
      'gemini:g': async () => {
        throw new Error('socket hang up');
      },
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], invoker);

    await expect(runReviewFan(ctx)).rejects.toThrow(/lane coverage 1\/2/);

    const verdicts = listVerdictArtifacts(tmpDir);
    expect(verdicts).toHaveLength(1);
    const v = verdicts[0]!;
    expect(v.attemptedLaneCount).toBe(2);
    expect(v.completedLaneCount).toBe(1);
    // 1 completed lane ⇒ NO panel was assembled.
    expect(v.panelArtifactHash).toBeUndefined();
    expect(v.diversity).toBeUndefined();
    expect(v.settled).toBe(false);
    // The verdict records the honest lane mix.
    expect(v.lanes.map((l) => l.status).sort()).toEqual(['completed', 'failed']);
  });

  it('two completed lanes assemble a panel from usable lanes only', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: wrapVerdict([]),
        provider: 'anthropic',
        model: 'claude-a',
        seed: 'a',
      }),
      'gemini:g': completedInvocation({
        content: wrapVerdict([]),
        provider: 'gemini',
        model: 'g',
        seed: 'b',
      }),
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], invoker);
    await runReviewFan(ctx); // dry → PASS, no throw

    const v = listVerdictArtifacts(tmpDir)[0]!;
    expect(v.completedLaneCount).toBe(2);
    expect(v.panelArtifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.diversity?.class).toBe('cross-vendor');
    expect(v.settled).toBe(true);
  });

  it('a CRITICAL persisting across two rounds never settles; a later dry round settles', async () => {
    const criticalContent = wrapVerdict([
      { severity: 'CRITICAL', confidence: 0.9, message: 'boom' },
    ]);
    const cleanContent = wrapVerdict([]);
    const git = fakeGit('feature-x', 'basesha');
    const lk = lineageKeyFor('feature-x', 'basesha', 'branch-vs-base');

    // Round 0 — CRITICAL present.
    await expect(
      runReviewFan(
        makeCtx(
          tmpDir,
          ['anthropic:claude-a', 'gemini:g'],
          mapInvoker({
            'anthropic:claude-a': completedInvocation({
              content: criticalContent,
              provider: 'anthropic',
              model: 'claude-a',
              seed: 'r0a',
            }),
            'gemini:g': completedInvocation({
              content: cleanContent,
              provider: 'gemini',
              model: 'g',
              seed: 'r0b',
            }),
          }),
          { gitExec: git },
        ),
      ),
    ).rejects.toThrow(/CRITICAL/);
    const r0 = findLatestVerdictForLineage(tmpDir, lk)!;
    expect(r0.round.index).toBe(0);
    expect(r0.settled).toBe(false);

    // Round 1 — same CRITICAL persists; must link as round 1 and still not settle.
    await expect(
      runReviewFan(
        makeCtx(
          tmpDir,
          ['anthropic:claude-a', 'gemini:g'],
          mapInvoker({
            'anthropic:claude-a': completedInvocation({
              content: criticalContent,
              provider: 'anthropic',
              model: 'claude-a',
              seed: 'r1a',
            }),
            'gemini:g': completedInvocation({
              content: cleanContent,
              provider: 'gemini',
              model: 'g',
              seed: 'r1b',
            }),
          }),
          { gitExec: git },
        ),
      ),
    ).rejects.toThrow(/CRITICAL/);
    const r1 = findLatestVerdictForLineage(tmpDir, lk)!;
    expect(r1.round.index).toBe(1);
    expect(r1.round.priorVerdictHash).toBeDefined();
    expect(r1.settled).toBe(false);

    // Round 2 — a genuinely dry round (both lanes clean) settles.
    await runReviewFan(
      makeCtx(
        tmpDir,
        ['anthropic:claude-a', 'gemini:g'],
        mapInvoker({
          'anthropic:claude-a': completedInvocation({
            content: cleanContent,
            provider: 'anthropic',
            model: 'claude-a',
            seed: 'r2a',
          }),
          'gemini:g': completedInvocation({
            content: cleanContent,
            provider: 'gemini',
            model: 'g',
            seed: 'r2b',
          }),
        }),
        { gitExec: git },
      ),
    );
    const r2 = findLatestVerdictForLineage(tmpDir, lk)!;
    expect(r2.round.index).toBe(2);
    expect(r2.settled).toBe(true);
  });

  it('two branches sharing base=main cannot cross-link (each starts at round 0)', async () => {
    const cleanContent = wrapVerdict([]);
    const mk = (branch: string, seed: string) =>
      makeCtx(
        tmpDir,
        ['anthropic:claude-a', 'gemini:g'],
        mapInvoker({
          'anthropic:claude-a': completedInvocation({
            content: cleanContent,
            provider: 'anthropic',
            model: 'claude-a',
            seed: `${seed}a`,
          }),
          'gemini:g': completedInvocation({
            content: cleanContent,
            provider: 'gemini',
            model: 'g',
            seed: `${seed}b`,
          }),
        }),
        { gitExec: fakeGit(branch, 'mainbase') },
      );

    await runReviewFan(mk('feature-a', 'fa'));
    await runReviewFan(mk('feature-b', 'fb'));

    const lkA = lineageKeyFor('feature-a', 'mainbase', 'branch-vs-base');
    const lkB = lineageKeyFor('feature-b', 'mainbase', 'branch-vs-base');
    expect(lkA).not.toBe(lkB);
    // Neither branch's round advanced past 0 — no cross-link occurred.
    expect(findLatestVerdictForLineage(tmpDir, lkA)!.round.index).toBe(0);
    expect(findLatestVerdictForLineage(tmpDir, lkB)!.round.index).toBe(0);
  });

  it('malformed lane output ⇒ abstained ⇒ not settled, not cache-eligible → SHIELD_FAILED', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: 'garbage, not a verdict',
        provider: 'anthropic',
        model: 'claude-a',
        seed: 'm',
      }),
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a'], invoker);
    await expect(runReviewFan(ctx)).rejects.toThrow(/SHIELD|lane coverage/i);
    const v = listVerdictArtifacts(tmpDir)[0]!;
    expect(v.lanes[0]!.status).toBe('abstained');
    expect(v.settled).toBe(false);
  });

  it('a sensor-tier post-check fail never gates: an otherwise-dry round still PASSes and settles', async () => {
    // Both lanes clean output, but their run artifacts carry a non-canonical
    // provenance class → the provenanceSensorRule (SENSOR) fails. It must not gate.
    const cleanContent = wrapVerdict([]);
    const invoker = mapInvoker({
      'anthropic:claude-a': {
        content: cleanContent,
        runArtifactHash: hex('sa'),
        runArtifact: makeRunArtifact({
          content: cleanContent,
          provider: 'anthropic',
          model: 'claude-a',
          badProvenance: true,
        }),
      },
      'gemini:g': {
        content: cleanContent,
        runArtifactHash: hex('sb'),
        runArtifact: makeRunArtifact({
          content: cleanContent,
          provider: 'gemini',
          model: 'g',
          badProvenance: true,
        }),
      },
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], invoker);
    await runReviewFan(ctx); // must not throw

    const v = listVerdictArtifacts(tmpDir)[0]!;
    expect(v.settled).toBe(true);
    // The sensor row IS recorded (honest) but did not gate.
    const sensorRow = v.postChecks.find((r) => r.ruleName === 'provenance-fail-safe-down');
    expect(sensorRow?.verdict).toBe('fail');
    expect(sensorRow?.tier).toBe('sensor');
  });

  it('a single-lane fan is legal and writes a verdict (degenerate-diversity sensor, never a block)', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: wrapVerdict([]),
        provider: 'anthropic',
        model: 'claude-a',
        seed: 's1',
      }),
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a'], invoker);
    await runReviewFan(ctx); // clean 1-lane fan → PASS
    const v = listVerdictArtifacts(tmpDir)[0]!;
    expect(v.attemptedLaneCount).toBe(1);
    expect(v.panelArtifactHash).toBeUndefined();
    expect(v.settled).toBe(true);
  });

  it('ALL lanes failing writes NO verdict and hard-errors', async () => {
    const invoker: LaneInvoker = async () => {
      throw new Error('socket hang up');
    };
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], invoker);
    await expect(runReviewFan(ctx)).rejects.toThrow(/All 2 review lane/);
    expect(listVerdictArtifacts(tmpDir)).toHaveLength(0);
  });

  it('--continues on a mismatched lineage warns but proceeds, recording the current lineage', async () => {
    const clean = wrapVerdict([]);
    // Seed a prior verdict on lineage A.
    await runReviewFan(
      makeCtx(
        tmpDir,
        ['anthropic:claude-a', 'gemini:g'],
        mapInvoker({
          'anthropic:claude-a': completedInvocation({
            content: clean,
            provider: 'anthropic',
            model: 'claude-a',
            seed: 'ca',
          }),
          'gemini:g': completedInvocation({
            content: clean,
            provider: 'gemini',
            model: 'g',
            seed: 'cb',
          }),
        }),
        { gitExec: fakeGit('feature-a', 'baseA') },
      ),
    );
    const priorHash = listVerdictArtifacts(tmpDir)[0]!;
    const priorContentHash = (await import('@mmnto/totem')).computeVerdictArtifactContentHash(
      priorHash,
    );

    // Continue it from a DIFFERENT branch/lineage.
    const errSpy = vi.spyOn(console, 'error');
    await runReviewFan(
      makeCtx(
        tmpDir,
        ['anthropic:claude-a', 'gemini:g'],
        mapInvoker({
          'anthropic:claude-a': completedInvocation({
            content: clean,
            provider: 'anthropic',
            model: 'claude-a',
            seed: 'cc',
          }),
          'gemini:g': completedInvocation({
            content: clean,
            provider: 'gemini',
            model: 'g',
            seed: 'cd',
          }),
        }),
        { gitExec: fakeGit('feature-b', 'baseB'), continues: priorContentHash },
      ),
    );
    const lkB = lineageKeyFor('feature-b', 'baseB', 'branch-vs-base');
    const continued = findLatestVerdictForLineage(tmpDir, lkB)!;
    // Linked as prior + 1, but recorded under the CURRENT (feature-b) lineage.
    expect(continued.round.index).toBe(priorHash.round.index + 1);
    expect(continued.round.priorVerdictHash).toBe(priorContentHash);
    expect(continued.round.lineageKey).toBe(lkB);
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/DIFFERENT lineage/);
  });

  it("mid-fan tree mutation on an otherwise-dry fan ⇒ reviewedState='drifted', settled=false, NO cache stamp (codex rev-2 gate 1)", async () => {
    // Both lanes complete cleanly (zero findings, no decidable fail) — the fan
    // would otherwise settle. But the tracked-source tree mutates DURING the fan:
    // the post-fan content hash differs from the pre-fan hash captured before it.
    const clean = wrapVerdict([]);
    const invoker = mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: clean,
        provider: 'anthropic',
        model: 'claude-a',
        seed: 'd1a',
      }),
      'gemini:g': completedInvocation({
        content: clean,
        provider: 'gemini',
        model: 'g',
        seed: 'd1b',
      }),
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], invoker, {
      preFanContentHash: 'pre-hash-abc',
      contentHash: async () => 'post-hash-different',
    });

    // A drifted fan is not cache-eligible ⇒ SHIELD_FAILED naming the drift.
    await expect(runReviewFan(ctx)).rejects.toThrow(/drift/i);

    // The verdict IS written (bound to the pre-fan diff), honestly marked drifted.
    const v = listVerdictArtifacts(tmpDir)[0]!;
    expect(v.reviewedState).toBe('drifted');
    expect(v.settled).toBe(false);
    expect(v.completedLaneCount).toBe(2); // otherwise dry
    expect(v.findings).toEqual([]);
    // No stamp authorizes the changed content.
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash'))).toBe(
      false,
    );
  });

  it('diffHash binds the delivered truncated masked <git_diff> segment; recomputes from the persisted masked prompt; truncated-away secret influences nothing (codex rev-2 gate 4)', async () => {
    // A diff exceeding MAX_DIFF_CHARS with a secret planted BEYOND the truncation
    // boundary — so the delivered `<git_diff>` segment never contains it.
    const SECRET = 'sk-' + 'z'.repeat(40); // matches a built-in DLP pattern
    const head = 'a'.repeat(MAX_DIFF_CHARS + 200);
    const fullDiff = `${head}\nLEAKED=${SECRET}\n`;
    // Emulate assemblePrompt: truncate at MAX_DIFF_CHARS + marker, wrap in <git_diff>.
    const truncated =
      fullDiff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`;
    const prompt = `SYSTEM PROMPT\n=== DIFF ===\n<git_diff>\n${truncated}\n</git_diff>\nEND`;

    let capturedPrompt = '';
    const invoker: LaneInvoker = async (_laneModel, deliveredPrompt) => {
      capturedPrompt = deliveredPrompt;
      const content = wrapVerdict([]);
      return {
        content,
        runArtifactHash: hex('g4'),
        // The persisted run artifact records EXACTLY the delivered masked prompt.
        runArtifact: {
          ...makeRunArtifact({ content, provider: 'anthropic', model: 'claude-a' }),
          inputBundle: { maskedPrompt: deliveredPrompt },
        },
      };
    };
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a'], invoker, {
      prompt,
      filteredDiff: fullDiff,
    });
    await runReviewFan(ctx);

    const v = listVerdictArtifacts(tmpDir)[0]!;
    // Extract the <git_diff> segment from the persisted (delivered) masked prompt.
    const seg = capturedPrompt.match(/<git_diff>\n([\s\S]*?)\n<\/git_diff>/)![1]!;
    expect(createHash('sha256').update(seg, 'utf-8').digest('hex')).toBe(v.diffScope.diffHash);
    // The truncated-away secret never entered the delivered payload nor the hash.
    expect(seg).not.toContain(SECRET);
    expect(capturedPrompt).not.toContain(SECRET);
  });

  it('review.lanes absent ⇒ no fan surface: [] from the validator, and an empty fan writes no verdict / no local-lane line (codex rev-2 gate 5/7)', async () => {
    // Production gate: absent lanes normalize to [] → shieldCommand's fanActive is
    // false → the legacy single-lane path runs unchanged (findings/display/exit/cache).
    expect(validateReviewLanes(undefined, 'anthropic')).toEqual([]);
    // And the fan — the SOLE emitter of the verdict artifact + additive `local-lane:`
    // line — produces neither when there are no lanes to converge.
    await expect(runReviewFan(makeCtx(tmpDir, [], mapInvoker({})))).rejects.toThrow(
      /All 0 review lane/,
    );
    expect(listVerdictArtifacts(tmpDir)).toHaveLength(0);
  });
});
