import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeLineageKey,
  computeVerdictArtifactContentHash,
  deriveCacheEligible,
  deriveSettled,
  findLatestVerdictForLineage,
  listVerdictArtifacts,
  readLedgerEvents,
  renderCovariateLine,
  type RunArtifact,
  type TotemConfig,
  TotemConfigError,
  VERDICT_ARTIFACT_SCHEMA_VERSION,
} from '@mmnto/totem';

import { EMPTY_SHARED } from '../exemptions/exemption-schema.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  assembleVerdict,
  assertFanFlagsSupported,
  buildDiffScope,
  classifyRejectedLane,
  type DiffScopeMeta,
  type GitExec,
  type LaneInvocation,
  type LaneInvoker,
  type LaneRunResult,
  printCovariateLine,
  resolveLineage,
  type ReviewFanContext,
  runLane,
  runReviewFan,
  validateReviewLanes,
} from './review-fan.js';
import { MAX_DIFF_CHARS, type ShieldFinding } from './shield-templates.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const hex = (seed: string): string => createHash('sha256').update(seed).digest('hex');

/** Test sink for the now-required scan `onWarn` (core is console-free; PR #2337 CR). */
const noWarn = (): void => {};

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
    const out = validateReviewLanes(
      ['anthropic:claude-x', 'gemini:gemini-2.5'],
      'anthropic',
      TotemConfigError,
    );
    expect(out).toEqual(['anthropic:claude-x', 'gemini:gemini-2.5']);
  });

  it('resolves a bare lane against the base provider', () => {
    const out = validateReviewLanes(['claude-x'], 'anthropic', TotemConfigError);
    expect(out).toEqual(['anthropic:claude-x']);
  });

  it('returns [] for absent lanes (legacy path)', () => {
    expect(validateReviewLanes(undefined, 'anthropic', TotemConfigError)).toEqual([]);
  });

  it('rejects the shell provider as an unsupported adapter for fan lanes (Gate G2)', () => {
    // Capability-admission wording — a support-limit error, not "structurally
    // ineligible" / allowlist phrasing.
    expect(() => validateReviewLanes(['shell:echo'], 'anthropic', TotemConfigError)).toThrow(
      /unsupported adapter for review fan lanes/,
    );
  });

  it('rejects duplicate normalized lanes', () => {
    expect(() =>
      validateReviewLanes(
        ['anthropic:claude-x', 'anthropic:claude-x'],
        'anthropic',
        TotemConfigError,
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown provider prefix', () => {
    expect(() =>
      validateReviewLanes(['weirdvendor:some-model'], 'anthropic', TotemConfigError),
    ).toThrow(/unknown provider/);
  });

  it('rejects empty / whitespace-only entries', () => {
    expect(() => validateReviewLanes(['  '], 'anthropic', TotemConfigError)).toThrow(/empty/);
  });

  it('rejects a bare lane when no base provider is configured', () => {
    expect(() => validateReviewLanes(['claude-x'], undefined, TotemConfigError)).toThrow(
      /no orchestrator provider/,
    );
  });
});

// ─── assertFanFlagsSupported (finding 12 — loud flag honesty) ─────────────────

describe('assertFanFlagsSupported', () => {
  it('rejects --suppress when the fan is active', () => {
    expect(() => assertFanFlagsSupported({ suppress: ['some-label'] }, TotemConfigError)).toThrow(
      /--suppress/,
    );
  });

  it('rejects --learn when the fan is active', () => {
    expect(() => assertFanFlagsSupported({ learn: true }, TotemConfigError)).toThrow(/--learn/);
  });

  it('rejects --auto-capture when the fan is active', () => {
    expect(() => assertFanFlagsSupported({ autoCapture: true }, TotemConfigError)).toThrow(
      /--auto-capture/,
    );
  });

  it('names ALL unsupported flags when several are combined', () => {
    expect(() =>
      assertFanFlagsSupported(
        { suppress: ['x'], learn: true, autoCapture: true },
        TotemConfigError,
      ),
    ).toThrow(/--suppress.*--learn.*--auto-capture/);
  });

  it('accepts a clean options set (no unsupported flags)', () => {
    expect(() => assertFanFlagsSupported({}, TotemConfigError)).not.toThrow();
    expect(() => assertFanFlagsSupported({ suppress: [] }, TotemConfigError)).not.toThrow();
  });
});

// ─── Predicates (core-owned deriveSettled / deriveCacheEligible — gate 6 + gate 8) ──

describe('deriveSettled / deriveCacheEligible (core-owned)', () => {
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
    configuredLane: 'anthropic:claude-x',
  });
  const warn = { severity: 'WARN' as const, confidence: 0.6, message: 'w' };
  const critical = { severity: 'CRITICAL' as const, confidence: 0.9, message: 'c' };

  it('a dry round settles and is cache-eligible', () => {
    const inputs = {
      lanes: [completedLane('a'), completedLane('b')],
      findings: [],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(deriveSettled(inputs)).toBe(true);
    expect(deriveCacheEligible(inputs)).toBe(true);
  });

  it('a WARN blocks settled but NOT cache-eligibility (WARN-drip class)', () => {
    const inputs = {
      lanes: [completedLane('a')],
      findings: [warn],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(deriveSettled(inputs)).toBe(false);
    expect(deriveCacheEligible(inputs)).toBe(true);
  });

  it('a CRITICAL blocks BOTH settled and cache-eligibility', () => {
    const inputs = {
      lanes: [completedLane('a')],
      findings: [critical],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(deriveSettled(inputs)).toBe(false);
    expect(deriveCacheEligible(inputs)).toBe(false);
  });

  it('a failed lane blocks BOTH (lane coverage conjunct)', () => {
    const inputs = {
      lanes: [completedLane('a'), failedLane('b')],
      findings: [],
      postChecks: [],
      reviewedState: 'matched' as const,
    };
    expect(deriveSettled(inputs)).toBe(false);
    expect(deriveCacheEligible(inputs)).toBe(false);
  });

  it("reviewedState 'drifted' blocks BOTH even on an otherwise-dry round (codex rev-2 fold 1)", () => {
    const inputs = {
      lanes: [completedLane('a'), completedLane('b')],
      findings: [],
      postChecks: [],
      reviewedState: 'drifted' as const,
    };
    expect(deriveSettled(inputs)).toBe(false);
    expect(deriveCacheEligible(inputs)).toBe(false);
  });

  it('a decidable-tier post-check fail gates BOTH; a sensor-tier fail gates NEITHER (gate 8)', () => {
    const base = {
      lanes: [completedLane('a')],
      findings: [],
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
    expect(deriveSettled(sensorFail)).toBe(true);
    expect(deriveCacheEligible(sensorFail)).toBe(true);

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
    expect(deriveSettled(decidableFail)).toBe(false);
    expect(deriveCacheEligible(decidableFail)).toBe(false);
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
    const result = await runLane(
      1,
      'anthropic:claude-x',
      invoker,
      EMPTY_SHARED,
      'delivered-prompt',
    );
    expect(result.lane.status).toBe('failed');
    if (result.lane.status === 'failed') {
      expect(result.lane.typedReason).toBe('missing-artifact-emission');
      // A failed lane (no backend resolved) uses the CONFIGURED lane in the laneId.
      expect(result.lane.laneId).toBe('lane-1:anthropic:claude-x');
    }
  });

  it('malformed lane output abstains (never a completed lane)', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-x': completedInvocation({ content: 'not a verdict at all', seed: 'l1' }),
    });
    const result = await runLane(
      0,
      'anthropic:claude-x',
      invoker,
      EMPTY_SHARED,
      'delivered-prompt',
    );
    expect(result.lane.status).toBe('abstained');
  });

  it('an extractable verdict completes with an honest severity tally + lane-blind laneId', async () => {
    const content = wrapVerdict([
      { severity: 'CRITICAL', confidence: 0.9, message: 'c' },
      { severity: 'WARN', confidence: 0.6, message: 'w' },
    ]);
    const invoker = mapInvoker({
      'anthropic:claude-x': completedInvocation({ content, seed: 'l2' }),
    });
    const result = await runLane(
      0,
      'anthropic:claude-x',
      invoker,
      EMPTY_SHARED,
      'delivered-prompt',
    );
    expect(result.lane.status).toBe('completed');
    if (result.lane.status === 'completed') {
      expect(result.lane.verdictSummary).toEqual({ critical: 1, warn: 1, info: 0 });
      expect(result.lane.resolvedBackend).toBe('anthropic:claude-x');
      // laneId is `lane-<index>:<resolvedBackend>` (Prop 302 G1 vocabulary).
      expect(result.lane.laneId).toBe('lane-0:anthropic:claude-x');
    }
    expect(result.filteredFindings).toHaveLength(2);
  });

  it('a quota throw REJECTS runLane and classifies to a failed quota-exhausted lane (finding 13)', async () => {
    const invoker: LaneInvoker = async () => {
      throw new Error('Quota exhausted for anthropic:claude-x.');
    };
    // runLane no longer swallows the invoker throw — it rejects, and the fan's
    // allSettled maps the rejection to a failed lane via classifyRejectedLane.
    await expect(
      runLane(0, 'anthropic:claude-x', invoker, EMPTY_SHARED, 'delivered-prompt'),
    ).rejects.toThrow(/Quota exhausted/);
    const classified = await classifyRejectedLane(
      2,
      'anthropic:claude-x',
      new Error('Quota exhausted for anthropic:claude-x.'),
    );
    expect(classified.lane.status).toBe('failed');
    if (classified.lane.status === 'failed') {
      expect(classified.lane.typedReason).toBe('quota-exhausted');
      expect(classified.lane.laneId).toBe('lane-2:anthropic:claude-x');
    }
  });

  it('a generic invoke throw classifies to a failed invoke-error lane', async () => {
    const classified = await classifyRejectedLane(
      0,
      'anthropic:claude-x',
      new Error('socket hang up'),
    );
    expect(classified.lane.status).toBe('failed');
    if (classified.lane.status === 'failed')
      expect(classified.lane.typedReason).toBe('invoke-error');
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

  it('--diff main (working-tree) and --diff main..HEAD (range) do NOT share a lineage (finding 10)', async () => {
    const git = fakeGit('feature-x', 'sharedbase');
    // Both resolve to base='main' head='HEAD' — only the raw selectorForm differs.
    const bareForm = await resolveLineage(
      { source: 'explicit-range', base: 'main', selectorForm: 'main' },
      git,
    );
    const rangeForm = await resolveLineage(
      { source: 'explicit-range', base: 'main', head: 'HEAD', selectorForm: 'main..HEAD' },
      git,
    );
    expect(bareForm.lineageKey).not.toBe(rangeForm.lineageKey);
    // Sanity: the same selector form is stable.
    const bareForm2 = await resolveLineage(
      { source: 'explicit-range', base: 'main', selectorForm: 'main' },
      git,
    );
    expect(bareForm.lineageKey).toBe(bareForm2.lineageKey);
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

  it('an explicit-range lineage never spawns git merge-base — only branch-vs-base needs it (greptile item 2)', async () => {
    // A spy git that RECORDS every probe. explicit-range keys on its base+head endpoints
    // and discards the merge-base, so `resolveMergeBase` must short-circuit WITHOUT
    // shelling out to `git merge-base` for it.
    const recordingGit = (): { git: GitExec; calls: string[][] } => {
      const calls: string[][] = [];
      const git: GitExec = (args) => {
        calls.push([...args]);
        if (args[0] === 'symbolic-ref') return 'feature-x';
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return REPO_TOPLEVEL;
        if (args[0] === 'rev-parse') return 'deadbeefdeadbeef';
        if (args[0] === 'merge-base') return 'shouldNotBeCalled';
        return '';
      };
      return { git, calls };
    };

    const range = recordingGit();
    await resolveLineage({ source: 'explicit-range', base: 'HEAD~3', head: 'HEAD' }, range.git);
    expect(range.calls.some((c) => c[0] === 'merge-base')).toBe(false);

    // Control: branch-vs-base DOES probe merge-base — proving the spy would have caught it.
    const branch = recordingGit();
    await resolveLineage({ source: 'branch-vs-base', base: 'main' }, branch.git);
    expect(branch.calls.some((c) => c[0] === 'merge-base')).toBe(true);
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
    const verdict = assembleVerdict(
      {
        diffScope: { source: 'staged', diffHash: hex('d') },
        laneResults: [lane('a', []), lane('b', [])],
        panelAndChecks: { postChecks: [] },
        round: { index: 0, lineageKey: 'lk' },
        reviewedState: 'matched',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      deriveSettled,
      VERDICT_ARTIFACT_SCHEMA_VERSION,
    );
    expect(verdict.attemptedLaneCount).toBe(2);
    expect(verdict.completedLaneCount).toBe(2);
    expect(verdict.reviewedState).toBe('matched');
    expect(verdict.settled).toBe(true);
    expect(verdict.panelArtifactHash).toBeUndefined();
  });

  it("records reviewedState='drifted' and forces settled=false on an otherwise-dry fan", () => {
    const verdict = assembleVerdict(
      {
        diffScope: { source: 'staged', diffHash: hex('d') },
        laneResults: [lane('a', []), lane('b', [])],
        panelAndChecks: { postChecks: [] },
        round: { index: 0, lineageKey: 'lk' },
        reviewedState: 'drifted',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      deriveSettled,
      VERDICT_ARTIFACT_SCHEMA_VERSION,
    );
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
  const lineageKeyFor = (branch: string, mergeBase: string, source: DiffScopeMeta['source']) => {
    switch (source) {
      case 'branch-vs-base':
        return computeLineageKey({
          repoIdentity: RESOLVED_REPO,
          branch,
          source,
          base: 'main',
          mergeBase,
        });
      case 'explicit-range':
        return computeLineageKey({
          repoIdentity: RESOLVED_REPO,
          branch,
          source,
          base: 'main',
          head: 'HEAD',
        });
      case 'staged':
      case 'uncommitted':
        return computeLineageKey({ repoIdentity: RESOLVED_REPO, branch, source });
    }
  };

  const oneFailedOnePassing = () =>
    mapInvoker({
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

  it('one failed + one passing lane: DEFAULT sensor exit 0 — honest counts, verdict written, NO panel (finding 3)', async () => {
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], oneFailedOnePassing());

    // Default (no --fail-on): degraded coverage does NOT throw (sensor exit 0).
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();

    const verdicts = listVerdictArtifacts(tmpDir, noWarn);
    expect(verdicts).toHaveLength(1);
    const v = verdicts[0]!.artifact;
    expect(v.attemptedLaneCount).toBe(2);
    expect(v.completedLaneCount).toBe(1);
    // 1 completed lane ⇒ NO panel was assembled.
    expect(v.panelArtifactHash).toBeUndefined();
    expect(v.diversity).toBeUndefined();
    expect(v.settled).toBe(false);
    // The verdict records the honest lane mix (a rejected lane is never lost — finding 13).
    expect(v.lanes.map((l) => l.status).sort()).toEqual(['completed', 'failed']);
  });

  it('one failed + one passing lane: --fail-on critical throws on the degraded (not cache-eligible) round', async () => {
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], oneFailedOnePassing(), {
      options: { failOn: 'critical' },
    });
    // No CRITICAL finding, but the round is not cache-eligible (a lane failed) ⇒ throws.
    await expect(runReviewFan(ctx)).rejects.toThrow(/lane coverage 1\/2/);
    // The honest verdict is still written before the throw.
    expect(listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact.completedLaneCount).toBe(1);
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

    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
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

    // Round 0 — CRITICAL present. Default sensor exit 0: writes the verdict, no throw.
    await runReviewFan(
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
    );
    const r0 = findLatestVerdictForLineage(tmpDir, lk, noWarn)!.artifact;
    expect(r0.round.index).toBe(0);
    expect(r0.settled).toBe(false);

    // Round 1 — same CRITICAL persists; must link as round 1 and still not settle.
    await runReviewFan(
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
    );
    const r1 = findLatestVerdictForLineage(tmpDir, lk, noWarn)!.artifact;
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
    const r2 = findLatestVerdictForLineage(tmpDir, lk, noWarn)!.artifact;
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
    expect(findLatestVerdictForLineage(tmpDir, lkA, noWarn)!.artifact.round.index).toBe(0);
    expect(findLatestVerdictForLineage(tmpDir, lkB, noWarn)!.artifact.round.index).toBe(0);
  });

  it('malformed lane output ⇒ abstained ⇒ not settled; abstained lane gets its decidable post-check fail row (finding 8)', async () => {
    const invoker = mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: 'garbage, not a verdict',
        provider: 'anthropic',
        model: 'claude-a',
        seed: 'm',
      }),
    });
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a'], invoker);
    // Default sensor exit 0: an abstaining fan writes the verdict and does NOT throw.
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();
    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
    expect(v.lanes[0]!.status).toBe('abstained');
    expect(v.settled).toBe(false);
    // Finding 8: the abstained lane's unextractable output persists a decidable
    // structured-output 'fail' row (post-checks now cover abstained lanes too).
    const row = v.postChecks.find((r) => r.ruleName === 'review-structured-verdict');
    expect(row?.tier).toBe('decidable');
    expect(row?.verdict).toBe('fail');
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

    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
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
    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
    expect(v.attemptedLaneCount).toBe(1);
    expect(v.panelArtifactHash).toBeUndefined();
    expect(v.settled).toBe(true);
  });

  it('ALL lanes failing WRITES the honest verdict FIRST, then hard-errors (Gate G3)', async () => {
    const invoker: LaneInvoker = async () => {
      throw new Error('socket hang up');
    };
    const ctx = makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], invoker);
    await expect(runReviewFan(ctx)).rejects.toThrow(/All 2 review lane/);
    // Gate G3: the honest verdict is written BEFORE the throw (all lanes failed).
    const verdicts = listVerdictArtifacts(tmpDir, noWarn);
    expect(verdicts).toHaveLength(1);
    const v = verdicts[0]!.artifact;
    expect(v.attemptedLaneCount).toBe(2);
    expect(v.completedLaneCount).toBe(0);
    expect(v.lanes.every((l) => l.status === 'failed')).toBe(true);
    expect(v.settled).toBe(false);
    expect(v.findings).toEqual([]);
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
    const prior = listVerdictArtifacts(tmpDir, noWarn)[0]!;
    // The STORED, verified address is the continues target (rev-6 item 1).
    const priorContentHash = prior.contentHash;

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
    const continued = findLatestVerdictForLineage(tmpDir, lkB, noWarn)!.artifact;
    // Linked as prior + 1, but recorded under the CURRENT (feature-b) lineage.
    expect(continued.round.index).toBe(prior.artifact.round.index + 1);
    expect(continued.round.priorVerdictHash).toBe(priorContentHash);
    expect(continued.round.lineageKey).toBe(lkB);
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/DIFFERENT lineage/);
  });

  it("tree mutation DURING post-check/panel/lineage ⇒ reviewedState='drifted', settled=false, NO cache stamp (findings 6, gate 1)", async () => {
    // Both lanes complete cleanly (zero findings, no decidable fail) — the fan
    // would otherwise settle. But the tracked-source tree mutates during the fan:
    // the post-fan content hash (sampled AFTER the post-check/panel/lineage work in
    // the real critical section — finding 6) differs from the pre-fan hash.
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

    // DEFAULT sensor exit 0: drift does NOT throw (no --fail-on); it is loud + un-stamped.
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();

    // The verdict IS written (bound to the pre-fan diff), honestly marked drifted.
    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
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

    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
    // Extract the <git_diff> segment from the persisted (delivered) masked prompt.
    const seg = capturedPrompt.match(/<git_diff>\n([\s\S]*?)\n<\/git_diff>/)![1]!;
    expect(createHash('sha256').update(seg, 'utf-8').digest('hex')).toBe(v.diffScope.diffHash);
    // The truncated-away secret never entered the delivered payload nor the hash.
    expect(seg).not.toContain(SECRET);
    expect(capturedPrompt).not.toContain(SECRET);
  });

  // ── Exit contract (finding 3 / Gate G5) ──

  const twoLaneInvoker = (aContent: string, seed: string) =>
    mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: aContent,
        provider: 'anthropic',
        model: 'claude-a',
        seed: `${seed}a`,
      }),
      'gemini:g': completedInvocation({
        content: wrapVerdict([]),
        provider: 'gemini',
        model: 'g',
        seed: `${seed}b`,
      }),
    });
  const CRITICAL_CONTENT = wrapVerdict([
    { severity: 'CRITICAL', confidence: 0.9, message: 'boom-critical-finding' },
  ]);
  const WARN_CONTENT = wrapVerdict([
    { severity: 'WARN', confidence: 0.6, message: 'a-warn-finding' },
  ]);

  it('DEFAULT sensor exit 0 even with CRITICAL findings present (finding 3 / OQ-2 re-rule)', async () => {
    const ctx = makeCtx(
      tmpDir,
      ['anthropic:claude-a', 'gemini:g'],
      twoLaneInvoker(CRITICAL_CONTENT, 'sd'),
    );
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();
    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
    expect(v.findings.some((f) => f.severity === 'CRITICAL')).toBe(true);
    expect(v.settled).toBe(false);
  });

  it('--fail-on critical throws on a CRITICAL round but NOT on a WARN-only round', async () => {
    await expect(
      runReviewFan(
        makeCtx(
          tmpDir,
          ['anthropic:claude-a', 'gemini:g'],
          twoLaneInvoker(CRITICAL_CONTENT, 'fc'),
          {
            options: { failOn: 'critical' },
          },
        ),
      ),
    ).rejects.toThrow(/CRITICAL/);
    // A WARN-only round is cache-eligible ⇒ --fail-on critical does NOT trip.
    await expect(
      runReviewFan(
        makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], twoLaneInvoker(WARN_CONTENT, 'fcw'), {
          options: { failOn: 'critical' },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('--fail-on warn throws on a WARN-only round', async () => {
    await expect(
      runReviewFan(
        makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], twoLaneInvoker(WARN_CONTENT, 'fw'), {
          options: { failOn: 'warn' },
        }),
      ),
    ).rejects.toThrow(/WARN/);
  });

  it('--override converts a --fail-on failure to pass AND ledgers the trap-ledgered stamp (matched tree)', async () => {
    const ctx = makeCtx(
      tmpDir,
      ['anthropic:claude-a', 'gemini:g'],
      twoLaneInvoker(CRITICAL_CONTENT, 'ov'),
      {
        options: {
          failOn: 'critical',
          override: 'operator-accepted false positive on the boom finding',
        },
      },
    );
    // Converted to a pass — no throw.
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();
    // The override is trap-ledgered (routed through recordShieldOverride).
    const events = readLedgerEvents(path.join(tmpDir, '.totem'));
    expect(events.some((e) => e.type === 'override' && e.ruleId === 'shield-override')).toBe(true);
  });

  it('drift + --override NEVER stamps — a drifted tree is never stampable, even overridden', async () => {
    const ctx = makeCtx(
      tmpDir,
      ['anthropic:claude-a', 'gemini:g'],
      twoLaneInvoker(wrapVerdict([]), 'dov'),
      {
        preFanContentHash: 'pre-hash-xyz',
        contentHash: async () => 'post-hash-drifted',
        options: { override: 'operator override on a drifted tree — must still refuse the stamp' },
      },
    );
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();
    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
    expect(v.reviewedState).toBe('drifted');
    // No stamp authorizes the changed content — even under --override.
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash'))).toBe(
      false,
    );
  });

  // ── rev-5 item 1 (codex critical falsifier): --override must never stamp an unreviewed tree ──

  it('FALSIFIER: tree mutates AFTER the fan compare but BEFORE override stamping ⇒ ledgered override, NO stamp (rev-5 item 1)', async () => {
    // The fan's one compare sees the pre-fan hash (matched); the tree then mutates
    // before the override stamp. The ledger+explicit-hash primitive recomputes the
    // current hash immediately adjacent to the stamp write and must refuse — the
    // current (mutated, unreviewed) tree hash is never stamped, and neither is the
    // pre-fan hash (it no longer describes the tree).
    const hashes = ['pre-fan-hash', 'post-compare-mutated-hash'];
    let calls = 0;
    const ctx = makeCtx(
      tmpDir,
      ['anthropic:claude-a', 'gemini:g'],
      twoLaneInvoker(CRITICAL_CONTENT, 'f1'),
      {
        preFanContentHash: 'pre-fan-hash',
        contentHash: async () => hashes[Math.min(calls++, hashes.length - 1)]!,
        options: { override: 'operator-accepted false positive — but the tree moved' },
      },
    );
    const errSpy = vi.spyOn(console, 'error');
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();
    // The fan compare saw 'pre-fan-hash' ⇒ matched; the adjacent recompute saw the mutation.
    expect(calls).toBe(2);
    const v = listVerdictArtifacts(tmpDir, noWarn)[0]!.artifact;
    expect(v.reviewedState).toBe('matched');
    // The override IS trap-ledgered (the operator's justification is auditable)…
    const events = readLedgerEvents(path.join(tmpDir, '.totem'));
    expect(events.some((e) => e.type === 'override' && e.ruleId === 'shield-override')).toBe(true);
    // …but NOTHING was stamped: not the pre-fan hash, and never the current tree hash.
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash'))).toBe(
      false,
    );
    // The refusal is loud.
    const out = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/OVERRIDE STAMP REFUSED/);
  });

  it('override stamp binds EXACTLY the pre-fan hash when the adjacent recompute still matches (rev-5 item 1 positive)', async () => {
    const ctx = makeCtx(
      tmpDir,
      ['anthropic:claude-a', 'gemini:g'],
      twoLaneInvoker(CRITICAL_CONTENT, 'f2'),
      {
        preFanContentHash: 'pre-fan-stable-hash',
        contentHash: async () => 'pre-fan-stable-hash',
        options: { override: 'operator-accepted false positive on a stable tree' },
      },
    );
    await expect(runReviewFan(ctx)).resolves.toBeUndefined();
    const stampPath = path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash');
    expect(fs.readFileSync(stampPath, 'utf-8')).toBe('pre-fan-stable-hash');
  });

  // ── rev-5 item 2: the stamp decision precedes ALL render/report I/O ──

  it('the stamp lands BEFORE the findings render / covariate line / --out report; render-time mutation cannot affect it (rev-5 item 2)', async () => {
    const outPath = path.join(tmpDir, 'fan-report.txt');
    const stampPath = path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash');
    let contentHashCalls = 0;
    let stampExistedAtFindingsRender: boolean | undefined;
    let stampExistedAtCovariateRender: boolean | undefined;
    let stampExistedAtOutWrite: boolean | undefined;
    // Observe the stamp file's state AT the moment each render side effect fires
    // (all render/log output goes through console.error). The `--out` write is bracketed
    // by its success log ("Fan report written"), which fires immediately AFTER writeOutput
    // — so reordering the --out write BEFORE the stamp would observe a missing stamp here
    // (item 6: the ordering assertion now covers writeOutput, not just findings/covariate).
    vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
      const line = args.map(String).join(' ');
      if (line.includes('Review fan —')) stampExistedAtFindingsRender = fs.existsSync(stampPath);
      if (line.includes('local-lane:')) stampExistedAtCovariateRender = fs.existsSync(stampPath);
      if (line.includes('Fan report written')) stampExistedAtOutWrite = fs.existsSync(stampPath);
    });
    const ctx = makeCtx(
      tmpDir,
      ['anthropic:claude-a', 'gemini:g'],
      twoLaneInvoker(wrapVerdict([]), 'ord'),
      {
        preFanContentHash: 'pre-hash-ordering',
        contentHash: async () => {
          contentHashCalls += 1;
          return 'pre-hash-ordering';
        },
        options: { out: outPath },
      },
    );
    await runReviewFan(ctx);
    // The single fan compare is the ONLY tree read on the ordinary path — no re-hash
    // during render/report I/O, so a mutation there cannot influence the stamp.
    expect(contentHashCalls).toBe(1);
    // The stamp decision was already durable when the findings render, the covariate
    // line, and the --out report happened.
    expect(stampExistedAtFindingsRender).toBe(true);
    expect(stampExistedAtCovariateRender).toBe(true);
    // item 6: the stamp was durable at the moment the --out report was written, too —
    // reordering writeOutput before the stamp would flip this to false.
    expect(stampExistedAtOutWrite).toBe(true);
    expect(fs.readFileSync(stampPath, 'utf-8')).toBe('pre-hash-ordering');
    expect(fs.existsSync(outPath)).toBe(true);
  });

  // ── Findings render (finding 2) ──

  it('a WARN round and a CRITICAL round both render the actual finding MESSAGES to output (finding 2)', async () => {
    const errSpy = vi.spyOn(console, 'error');
    await runReviewFan(
      makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], twoLaneInvoker(WARN_CONTENT, 'rw')),
    );
    let out = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('a-warn-finding');

    errSpy.mockClear();
    await runReviewFan(
      makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], twoLaneInvoker(CRITICAL_CONTENT, 'rc')),
    );
    out = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('boom-critical-finding');
  });

  it('--out writes the human-readable fan report (findings + lanes + covariate line)', async () => {
    const outPath = path.join(tmpDir, 'fan-report.txt');
    await runReviewFan(
      makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], twoLaneInvoker(WARN_CONTENT, 'out'), {
        options: { out: outPath },
      }),
    );
    const report = fs.readFileSync(outPath, 'utf-8');
    expect(report).toContain('a-warn-finding');
    expect(report).toContain('lane-0:anthropic:claude-a');
    expect(report).toContain('local-lane:');
  });

  // ── Parallel determinism (finding 13) ──

  it('lanes completing OUT OF ORDER yield an artifact identical to in-order completion (finding 13)', async () => {
    const clean = wrapVerdict([]);
    const laneA = (): LaneInvocation =>
      completedInvocation({ content: clean, provider: 'anthropic', model: 'claude-a', seed: 'pa' });
    const laneB = (): LaneInvocation =>
      completedInvocation({ content: clean, provider: 'gemini', model: 'g', seed: 'pb' });
    const delayed =
      (inv: LaneInvocation, ms: number): (() => Promise<LaneInvocation>) =>
      () =>
        new Promise((resolve) => setTimeout(() => resolve(inv), ms));

    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'fan-order1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fan-order2-'));
    try {
      // Run 1: lane A slow, lane B fast (B completes first).
      await runReviewFan(
        makeCtx(
          dir1,
          ['anthropic:claude-a', 'gemini:g'],
          mapInvoker({
            'anthropic:claude-a': delayed(laneA(), 25),
            'gemini:g': delayed(laneB(), 1),
          }),
        ),
      );
      // Run 2: lane A fast, lane B slow (A completes first).
      await runReviewFan(
        makeCtx(
          dir2,
          ['anthropic:claude-a', 'gemini:g'],
          mapInvoker({
            'anthropic:claude-a': delayed(laneA(), 1),
            'gemini:g': delayed(laneB(), 25),
          }),
        ),
      );
      const v1 = listVerdictArtifacts(dir1, noWarn)[0]!;
      const v2 = listVerdictArtifacts(dir2, noWarn)[0]!;
      // Content hash excludes createdAt → identical regardless of completion order. The
      // STORED addresses (verified filename stems) are equal for the same logical round.
      expect(v1.contentHash).toBe(v2.contentHash);
      expect(computeVerdictArtifactContentHash(v1.artifact)).toBe(
        computeVerdictArtifactContentHash(v2.artifact),
      );
      // Lanes are canonicalized into configured order in both.
      expect(v1.artifact.lanes.map((l) => l.laneId)).toEqual([
        'lane-0:anthropic:claude-a',
        'lane-1:gemini:g',
      ]);
      expect(v2.artifact.lanes.map((l) => l.laneId)).toEqual(
        v1.artifact.lanes.map((l) => l.laneId),
      );
    } finally {
      cleanTmpDir(dir1);
      cleanTmpDir(dir2);
    }
  });

  it('review.lanes absent ⇒ no fan surface: [] from the validator, and an empty fan writes no verdict / no local-lane line (codex rev-2 gate 5/7)', async () => {
    // Production gate: absent lanes normalize to [] → shieldCommand's fanActive is
    // false → the legacy single-lane path runs unchanged (findings/display/exit/cache).
    expect(validateReviewLanes(undefined, 'anthropic', TotemConfigError)).toEqual([]);
    // And the fan — the SOLE emitter of the verdict artifact + additive `local-lane:`
    // line — produces neither when there are no lanes to converge.
    await expect(runReviewFan(makeCtx(tmpDir, [], mapInvoker({})))).rejects.toThrow(
      /All 0 review lane/,
    );
    expect(listVerdictArtifacts(tmpDir, noWarn)).toHaveLength(0);
  });
});

// ─── printCovariateLine (rev-5 item 4 — executable covariate transport) ────────

describe('printCovariateLine (rev-5 item 4)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covariate-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  const cleanTwoLaneInvoker = () =>
    mapInvoker({
      'anthropic:claude-a': completedInvocation({
        content: wrapVerdict([]),
        provider: 'anthropic',
        model: 'claude-a',
        seed: 'cva',
      }),
      'gemini:g': completedInvocation({
        content: wrapVerdict([]),
        provider: 'gemini',
        model: 'g',
        seed: 'cvb',
      }),
    });

  it('prints the EXACT core-owned covariate line for the current lineage on stdout (mechanical)', async () => {
    const git = fakeGit('feature-cov', 'covbase');
    // Write a verdict via a real fan run (same lineage resolution the covariate uses).
    await runReviewFan(
      makeCtx(tmpDir, ['anthropic:claude-a', 'gemini:g'], cleanTwoLaneInvoker(), {
        gitExec: git,
      }),
    );
    const verdict = listVerdictArtifacts(tmpDir, noWarn)[0]!;

    const logSpy = vi.mocked(console.log);
    logSpy.mockClear();
    await printCovariateLine({
      diffMeta: { source: 'branch-vs-base', base: 'main' },
      totemDirAbs: tmpDir,
      cwd: tmpDir,
      gitExec: git,
    });
    // EXACTLY the core renderer's line, on stdout — format v1, byte-for-byte.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(renderCovariateLine(verdict));
    const line = String(logSpy.mock.calls[0]![0]);
    expect(line).toMatch(/^local-lane: [0-9a-f]{8} round=0 settled=true lanes=2\/2$/);
  });

  it('resolves the LATEST verdict for the lineage (round chain respected)', async () => {
    const git = fakeGit('feature-cov', 'covbase');
    const mk = (seed: string) =>
      makeCtx(
        tmpDir,
        ['anthropic:claude-a', 'gemini:g'],
        mapInvoker({
          'anthropic:claude-a': completedInvocation({
            content: wrapVerdict([]),
            provider: 'anthropic',
            model: 'claude-a',
            seed: `${seed}a`,
          }),
          'gemini:g': completedInvocation({
            content: wrapVerdict([]),
            provider: 'gemini',
            model: 'g',
            seed: `${seed}b`,
          }),
        }),
        { gitExec: git },
      );
    await runReviewFan(mk('r0'));
    await runReviewFan(mk('r1'));

    const logSpy = vi.mocked(console.log);
    logSpy.mockClear();
    await printCovariateLine({
      diffMeta: { source: 'branch-vs-base', base: 'main' },
      totemDirAbs: tmpDir,
      cwd: tmpDir,
      gitExec: git,
    });
    expect(String(logSpy.mock.calls[0]![0])).toContain('round=1');
  });

  it('no verdict for the lineage ⇒ loud sensor message, NO stdout line, clean return (exit 0)', async () => {
    const errSpy = vi.mocked(console.error);
    const logSpy = vi.mocked(console.log);
    await expect(
      printCovariateLine({
        diffMeta: { source: 'branch-vs-base', base: 'main' },
        totemDirAbs: tmpDir,
        cwd: tmpDir,
        gitExec: fakeGit('feature-none', 'nobase'),
      }),
    ).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
    const out = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/no verdict artifact recorded for the current lineage/i);
  });

  it('no diff scope (diffMeta null) ⇒ loud sensor message, NO stdout line, clean return', async () => {
    const errSpy = vi.mocked(console.error);
    const logSpy = vi.mocked(console.log);
    await expect(
      printCovariateLine({ diffMeta: null, totemDirAbs: tmpDir, cwd: tmpDir }),
    ).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
    const out = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/no diff detected/i);
  });
});
