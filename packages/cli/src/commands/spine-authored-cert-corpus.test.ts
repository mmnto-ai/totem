import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import type {
  AuthoredControlsDeps,
  CertCorpusSeed,
  GroundTruthLabel,
  PreimageDifferentialOutcome,
  PreimageDifferentialResult,
  PrMeta,
  RuleFiring,
  ScorerInput,
  SplitArtifact,
  Stage4VerifierDeps,
  WindtunnelLock,
} from '@mmnto/totem';
import {
  CertCorpusSeedSchema,
  firingLabelId,
  scoreWindtunnel,
  WindtunnelLockSchema,
} from '@mmnto/totem';

import { runRuleAuthor } from '../authored-rule-intake.js';
import {
  buildAuthoredCertifyingCorpus,
  type BuildAuthoredCertifyingCorpusDeps,
} from './spine-authored-cert-corpus.js';
import { materializeAuthored } from './spine-authored-materialize.js';
import {
  assembleAuthoredCertifyingCorpus,
  resolveCertifyingCorpusProvider,
} from './spine-cert-run-corpus.js';

// ─── Fixtures (mirror the slice-2/3/4 + authored-controls tests) ──────────────

const sha = (n: number): string => String(n).padStart(40, '0');
const NOW = '2026-06-19T12:00:00.000Z';
const SPLIT_REF = 'split-cert-1';
const JUDGED_BY = 'static-whitelist@cert-1';
const LESSON_REF = 'deadbeefdeadbeef';

/** A regex DSL that compiles cleanly + fires on `forbiddenCall()`. */
const REGEX_DSL = [
  '**Pattern:** `forbiddenCall\\(`',
  '**Engine:** regex',
  '**Severity:** warning',
  '',
  '### Bad Example',
  '```ts',
  'forbiddenCall()',
  '```',
].join('\n');

/** A regex DSL that PARSES but fails per-engine validation (unterminated group) → compile-rejected. */
const BAD_REGEX_DSL = [
  '**Pattern:** `(unclosed`',
  '**Engine:** regex',
  '**Severity:** warning',
].join('\n');

const SPLIT: SplitArtifact = {
  asOfCommit: sha(100),
  trainPrs: [1],
  heldOutPrs: [],
  excludedPrs: [],
  positiveControlPrs: [],
  negativeControlPrs: [],
  splitRule: { predicate: 'code-touching non-bot', cutIndex: 1 },
};

interface AuthoredRuleInputLike {
  author: string;
  authoredAt: string;
  targetDefect: string;
  declaredEngine: string;
  structuralClass: string;
  dslSource: string;
  positiveFixtures: unknown[];
  negativeFixtures?: unknown[];
}

function posFixture(pr = 1, filePath = 'src/a.ts', matchedSpan = 'L1-L2') {
  return {
    pr,
    preimageSource: {
      kind: 'lesson',
      lessonRef: LESSON_REF,
      badExample: 'bad()',
      goodExample: 'good()',
    },
    filePath,
    matchedSpan,
    contentHash: `ch-${pr}-${filePath}`,
  };
}

function authoredRuleInput(overrides: Partial<AuthoredRuleInputLike> = {}): AuthoredRuleInputLike {
  return {
    author: 'agent-x',
    authoredAt: '2026-06-01',
    targetDefect: 'a real lc defect',
    declaredEngine: 'regex',
    structuralClass: 'forbidden-literal-token',
    dslSource: REGEX_DSL,
    positiveFixtures: [posFixture()],
    ...overrides,
  };
}

/** Write a valid `.totem/spine/authored-rules.yaml` into the temp totemDir. */
function writeAuthoredYaml(
  totemDir: string,
  opts: { splitRef?: string; rules?: AuthoredRuleInputLike[] } = {},
): void {
  const fileDoc = {
    splitRef: opts.splitRef ?? SPLIT_REF,
    authoredAfterSplit: true,
    heldOutNonInspectionAttestation: true,
    rules: opts.rules ?? [authoredRuleInput()],
  };
  const dir = path.join(totemDir, 'spine');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'authored-rules.yaml'), stringify(fileDoc), 'utf-8');
  // Author-first (strategy (iii)): seed the authoring-ledger via runRuleAuthor, mirroring the
  // production order (`totem rule author` runs BEFORE a cert run). buildAuthoredCertifyingCorpus
  // now sources judgedBy from the pre-existing ledger (no lock/deps judgedBy), so the ledger
  // must exist before the build. JUDGED_BY is the §3 check id the ledger records per-rule.
  runRuleAuthor(totemDir, { judgedBy: JUDGED_BY });
}

/**
 * Write the AUTHORED scoring substrate (split + pr-diffs + ground-truth) into a gate-1
 * dir and return the integrity shas the lock must carry — the LF-normalized sha256 the
 * loader (`readAndVerifyScoringSubstrate`) re-derives on its single read. The split is
 * NOT hash-gated (no integrity sha in the loader); pr-diffs + ground-truth are.
 */
function writeSubstrate(
  gate1Dir: string,
  opts: {
    split?: SplitArtifact;
    prDiffs?: unknown[];
    groundTruth?: Record<string, 'TP' | 'FP'>;
  } = {},
): { prDiffsSha: string; groundTruthSha: string } {
  fs.mkdirSync(gate1Dir, { recursive: true });
  const splitJson = JSON.stringify(opts.split ?? SPLIT);
  const prDiffsJson = JSON.stringify(opts.prDiffs ?? []);
  const gtJson = JSON.stringify(opts.groundTruth ?? {});
  fs.writeFileSync(path.join(gate1Dir, 'split.json'), splitJson, 'utf-8');
  fs.writeFileSync(path.join(gate1Dir, 'pr-diffs.json'), prDiffsJson, 'utf-8');
  fs.writeFileSync(path.join(gate1Dir, 'ground-truth-labels.json'), gtJson, 'utf-8');
  const sha = (s: string): string =>
    createHash('sha256').update(s.replace(/\r\n/g, '\n'), 'utf-8').digest('hex');
  return { prDiffsSha: sha(prDiffsJson), groundTruthSha: sha(gtJson) };
}

/** Fake Stage-4 deps — `forbiddenCall()` present in a non-test file ⇒ active (scored). */
function stage4(
  files: Record<string, string> = { 'src/a.ts': 'forbiddenCall()' },
): Stage4VerifierDeps {
  return {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readFile: (f: string) =>
      f in files ? Promise.resolve(files[f] as string) : Promise.reject(new Error(`absent ${f}`)),
  };
}

/** Stage-4 deps that THROW if touched — proves a guard fired BEFORE compile. */
function explodingStage4(): Stage4VerifierDeps {
  return {
    listFiles: () => {
      throw new Error('compile must not run');
    },
    readFile: () => {
      throw new Error('compile must not run');
    },
  };
}

/** §4 differential stub: drive every fixture to one outcome (no git, no engine). */
function diffDeps(outcome: PreimageDifferentialOutcome): AuthoredControlsDeps {
  const result: PreimageDifferentialResult = {
    outcome,
    sourceKind: 'lesson',
    firesOnPreimage: null,
    silentOnPostimage: null,
    preimageMatchCount: null,
    postimageMatchCount: null,
  };
  return { evaluate: () => Promise.resolve(result) };
}

function baseDeps(
  totemDir: string,
  overrides: Partial<BuildAuthoredCertifyingCorpusDeps> = {},
): BuildAuthoredCertifyingCorpusDeps {
  return {
    totemDir,
    expectedSplitRef: SPLIT_REF,
    split: SPLIT,
    prDiffs: [],
    groundTruth: new Map(),
    stage4: stage4(),
    now: NOW,
    authoredControlsDeps: diffDeps('differential-holds'),
    ...overrides,
  };
}

// ─── Temp totemDir lifecycle ──────────────────────────

let totemDir: string;
beforeEach(() => {
  totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-authored-cert-'));
});
afterEach(() => {
  fs.rmSync(totemDir, { recursive: true, force: true });
});

// ─── 1. Production path (REAL compile, no mocked CompiledCandidate[]) ──────────

describe('buildAuthoredCertifyingCorpus — production path', () => {
  it('authored YAML → runRuleAuthor → toCompileFeed → runCompileStage → authored corpus + populated controls', async () => {
    writeAuthoredYaml(totemDir);
    const corpus = await buildAuthoredCertifyingCorpus(baseDeps(totemDir));

    expect(corpus.rules).toHaveLength(1);
    const rule = corpus.rules[0]!;

    // Provenance is the SIDECAR authored record (NOT rule.legitimacy — absent pre-verdict).
    const prov = corpus.provenanceByRule.get(rule.lessonHash);
    expect(prov && 'kind' in prov && prov.kind).toBe('authored');
    expect(rule.legitimacy).toBeUndefined();

    // authoredControls populated with the TRUE positive shape (no contentHash/preimageSource).
    expect(corpus.authoredControls).toBeDefined();
    expect(corpus.authoredControls!.positive).toEqual([
      { pr: 1, targetRuleId: rule.lessonHash, filePath: 'src/a.ts', matchedSpan: 'L1-L2' },
    ]);
    expect(corpus.authoredControls!.negative).toEqual([]);
    expect(corpus.authoredControls!.nonEmissions).toEqual([]);

    // The scoring substrate is passed through untouched.
    expect(corpus.prDiffs).toEqual([]);
    expect(corpus.groundTruth.size).toBe(0);
  });
});

// ─── 2. Fail-loud assembly contract guards ────────────────────────────────────

describe('buildAuthoredCertifyingCorpus — fail-loud guards', () => {
  it('any rejected authored record fails the build (never certify the eligible subset)', async () => {
    writeAuthoredYaml(totemDir, {
      rules: [
        authoredRuleInput(), // eligible
        authoredRuleInput({
          targetDefect: 'undecidable defect',
          structuralClass: 'not-in-whitelist',
        }),
      ],
    });
    await expect(buildAuthoredCertifyingCorpus(baseDeps(totemDir))).rejects.toThrow(
      /rejected by the structural-eligibility check/,
    );
  });

  it('an authored compile-rejection fails the build (not a partial corpus)', async () => {
    writeAuthoredYaml(totemDir, { rules: [authoredRuleInput({ dslSource: BAD_REGEX_DSL })] });
    await expect(buildAuthoredCertifyingCorpus(baseDeps(totemDir))).rejects.toThrow(
      /rejected at compile/,
    );
  });

  it('a file/ledger split mismatch fails BEFORE compile (stage4 never runs)', async () => {
    writeAuthoredYaml(totemDir); // authored under SPLIT_REF
    await expect(
      buildAuthoredCertifyingCorpus(
        baseDeps(totemDir, { expectedSplitRef: 'split-DIFFERENT', stage4: explodingStage4() }),
      ),
    ).rejects.toThrow(/different split/);
  });

  // (The §5 embargo attestations `authoredAfterSplit` / `heldOutNonInspectionAttestation`
  // are `z.literal(true)` in AuthoredRulesFileSchema, so runRuleAuthor rejects any file
  // lacking them before the assembler runs — there is no reachable assembler branch to
  // test. The reachable §5 guard is the splitRef binding, covered above.)
});

// ─── 3. Channel 3-state matrix (authored side; mined→undefined lives in cert-corpus.test) ─

describe('buildAuthoredCertifyingCorpus — authoredControls channel', () => {
  it('authored with an EMITTING fixture → channel populated', async () => {
    writeAuthoredYaml(totemDir);
    const corpus = await buildAuthoredCertifyingCorpus(baseDeps(totemDir));
    expect(corpus.authoredControls!.positive).toHaveLength(1);
  });

  it('authored with NO emitting fixture → channel DEFINED with empty positive/negative arrays', async () => {
    writeAuthoredYaml(totemDir);
    const corpus = await buildAuthoredCertifyingCorpus(
      baseDeps(totemDir, { authoredControlsDeps: diffDeps('fix-shaped') }),
    );
    // Never undefined for an authored corpus — defined object, empty emission arrays.
    expect(corpus.authoredControls).toBeDefined();
    expect(corpus.authoredControls!.positive).toEqual([]);
    expect(corpus.authoredControls!.negative).toEqual([]);
    // The non-emitting fixture is KEPT (never silently dropped) as a classed non-emission.
    expect(corpus.authoredControls!.nonEmissions).toHaveLength(1);
    expect(corpus.authoredControls!.nonEmissions[0]).toMatchObject({
      pr: 1,
      outcome: 'fix-shaped',
      class: 'illegitimate',
    });
  });
});

// ─── 4. Single-home dispatch (provider resolution off lock.producerKind) — D2 ──

describe('resolveCertifyingCorpusProvider — producerKind dispatch (D2 async single-home)', () => {
  let gate1Dir: string;
  beforeEach(() => {
    gate1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-d2-gate1-'));
  });
  afterEach(() => {
    fs.rmSync(gate1Dir, { recursive: true, force: true });
  });

  /** Kind-agnostic raw run-context the caller passes unconditionally (no producerKind branch). */
  const inputs = (
    extra: Partial<{ authoredControlsDeps: AuthoredControlsDeps }> = {},
  ): Parameters<typeof resolveCertifyingCorpusProvider>[1] => ({
    gate1Dir,
    stage4: stage4(),
    now: NOW,
    totemDir,
    ...extra,
  });

  /** A minimal lock cast — the resolver only reads producerKind / authored / integrity shas. */
  const lock = (overrides: Record<string, unknown>): WindtunnelLock =>
    ({ controls: { integrity: {} }, ...overrides }) as unknown as WindtunnelLock;

  it('a mined lock (explicit or absent) resolves to a { provider, score } bundle', async () => {
    for (const overrides of [{ producerKind: 'mined' }, {}]) {
      const resolved = await resolveCertifyingCorpusProvider(lock(overrides), inputs());
      expect(resolved.provider).toBeTypeOf('function');
      expect(resolved.score).toBeTypeOf('function');
    }
  });

  it('an authored lock WITHOUT an `authored` block fails loud (require-when-authored)', async () => {
    await expect(
      resolveCertifyingCorpusProvider(lock({ producerKind: 'authored' }), inputs()),
    ).rejects.toThrow(/run-input block/);
  });

  it('an authored lock missing prDiffsSha / groundTruthSha fails loud (same hard preconditions as mined)', async () => {
    const authored = { expectedSplitRef: SPLIT_REF };
    await expect(
      resolveCertifyingCorpusProvider(
        lock({
          producerKind: 'authored',
          authored,
          controls: { integrity: { groundTruthSha: 'x' } },
        }),
        inputs(),
      ),
    ).rejects.toThrow(/prDiffsSha/);
    await expect(
      resolveCertifyingCorpusProvider(
        lock({ producerKind: 'authored', authored, controls: { integrity: { prDiffsSha: 'x' } } }),
        inputs(),
      ),
    ).rejects.toThrow(/groundTruthSha/);
  });

  it('an authored lock + substrate + authored YAML → authored provider yields an authored corpus (e2e input path)', async () => {
    writeAuthoredYaml(totemDir);
    const { prDiffsSha, groundTruthSha } = writeSubstrate(gate1Dir);
    const authoredLock = lock({
      producerKind: 'authored',
      authored: { expectedSplitRef: SPLIT_REF },
      controls: { integrity: { prDiffsSha, groundTruthSha } },
    });
    const { provider, score } = await resolveCertifyingCorpusProvider(
      authoredLock,
      inputs({ authoredControlsDeps: diffDeps('differential-holds') }),
    );
    // D4: the §8 single home also binds the producer-kind scorer alongside the provider.
    expect(score).toBeTypeOf('function');
    const corpus = await provider(authoredLock);
    expect(corpus.authoredControls).toBeDefined();
    expect(corpus.authoredControls!.positive).toHaveLength(1);
    // The scoring substrate (prDiffs/groundTruth) came from the loaded fixtures, proving
    // the lock-driven AUTHORED loader wired through (D2) — empty here, but loaded not faked.
    expect(corpus.prDiffs).toEqual([]);
    expect(corpus.groundTruth.size).toBe(0);
  });

  it('an authored lock whose substrate fails integrity (tampered pr-diffs) fails loud', async () => {
    writeAuthoredYaml(totemDir);
    const { groundTruthSha } = writeSubstrate(gate1Dir);
    const authoredLock = lock({
      producerKind: 'authored',
      authored: { expectedSplitRef: SPLIT_REF },
      controls: { integrity: { prDiffsSha: 'f'.repeat(64), groundTruthSha } },
    });
    await expect(resolveCertifyingCorpusProvider(authoredLock, inputs())).rejects.toThrow(
      /pr-diffs\.json integrity FAILED/,
    );
  });
});

// ─── 5. Slice D2.6 — the window-wide answer-key DERIVER's authored assembler ───
//
// `assembleAuthoredCertifyingCorpus` is the derive-path sibling of `assembleCertifyingCorpus`:
// `derive-labels` calls it directly (NOT `resolveCertifyingCorpusProvider` — the §8 RUN-path
// single home is untouched). It ALWAYS skips ground-truth (the deriver PRODUCES the key) yet
// still hash-binds the scoring source (`prDiffsSha`).

describe('assembleAuthoredCertifyingCorpus (D2.6 derive-path sibling)', () => {
  let gate1Dir: string;
  beforeEach(() => {
    gate1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-d26-gate1-'));
  });
  afterEach(() => {
    fs.rmSync(gate1Dir, { recursive: true, force: true });
  });

  const lock = (overrides: Record<string, unknown>): WindtunnelLock =>
    ({ controls: { integrity: {} }, ...overrides }) as unknown as WindtunnelLock;

  const opts = (
    extra: Partial<{ authoredControlsDeps: AuthoredControlsDeps }> = {},
  ): Parameters<typeof assembleAuthoredCertifyingCorpus>[0] => ({
    gate1Dir,
    totemDir,
    stage4: stage4(),
    now: NOW,
    ...extra,
  });

  it('fails loud when the authored lock has no `authored` block (require-when-authored)', async () => {
    await expect(
      assembleAuthoredCertifyingCorpus(opts(), lock({ producerKind: 'authored' })),
    ).rejects.toThrow(/run-input block/);
  });

  it('fails loud when the lock is missing prDiffsSha (scoring source un-gated)', async () => {
    await expect(
      assembleAuthoredCertifyingCorpus(
        opts(),
        lock({ producerKind: 'authored', authored: { expectedSplitRef: SPLIT_REF } }),
      ),
    ).rejects.toThrow(/prDiffsSha/);
  });

  it('derives WITHOUT groundTruthSha and never reads the answer key (circularity guard)', async () => {
    writeAuthoredYaml(totemDir);
    // A NON-EMPTY ground-truth file on disk + NO groundTruthSha on the lock: the deriver must
    // still succeed (it PRODUCES this key) and must NOT read it — skip ⇒ empty groundTruth.
    const { prDiffsSha } = writeSubstrate(gate1Dir, { groundTruth: { 'stale:id': 'TP' } });
    const authoredLock = lock({
      producerKind: 'authored',
      authored: { expectedSplitRef: SPLIT_REF },
      controls: { integrity: { prDiffsSha } },
    });
    const { corpus } = await assembleAuthoredCertifyingCorpus(
      opts({ authoredControlsDeps: diffDeps('differential-holds') }),
      authoredLock,
    );
    // The authored pipeline ran (rules + §6 controls assembled from the substrate)…
    expect(corpus.authoredControls).toBeDefined();
    expect(corpus.authoredControls!.positive).toHaveLength(1);
    // …and ground-truth was SKIPPED — the on-disk 'stale:id' entry was never read.
    expect(corpus.groundTruth.size).toBe(0);
  });

  it('still hash-binds the SCORING source — a tampered pr-diffs.json fails loud', async () => {
    writeAuthoredYaml(totemDir);
    const { prDiffsSha } = writeSubstrate(gate1Dir); // sha over the pristine bytes
    fs.writeFileSync(
      path.join(gate1Dir, 'pr-diffs.json'),
      JSON.stringify([{ pr: 1, diff: 'tampered', controlKind: 'corpus' }]),
      'utf-8',
    );
    const authoredLock = lock({
      producerKind: 'authored',
      authored: { expectedSplitRef: SPLIT_REF },
      controls: { integrity: { prDiffsSha } },
    });
    await expect(assembleAuthoredCertifyingCorpus(opts(), authoredLock)).rejects.toThrow(
      /pr-diffs\.json integrity/,
    );
  });
});

// ─── 6. Slice D4 — the reachable flip: resolved.score(base) end-to-end ─────────
//
// The whole-path couple strategy reviews (ruling 2318Z, Q4 — 4 seams): (1) authored
// corpus resolution (§8 single-home), (2) the no-mint verifyOnly gate FIRING, (3)
// scoreAuthoredWindtunnel invocation (Q1 threading guard), (4) the Gate-2 emit
// (verdict-inert, §1(k)-guarded). These rows drive a REAL resolve → real scorer
// (never a mock) → real deriveGate2Eligibility, reusing the D1–D3 fixtures.

describe('ADR-112 D4 — reachable flip: resolved.score(base) end-to-end', () => {
  let gate1Dir: string;
  beforeEach(() => {
    gate1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-d4-gate1-'));
  });
  afterEach(() => {
    fs.rmSync(gate1Dir, { recursive: true, force: true });
  });

  const inputs = (
    extra: Partial<{ authoredControlsDeps: AuthoredControlsDeps }> = {},
  ): Parameters<typeof resolveCertifyingCorpusProvider>[1] => ({
    gate1Dir,
    stage4: stage4(),
    now: NOW,
    totemDir,
    ...extra,
  });

  const lock = (overrides: Record<string, unknown>): WindtunnelLock =>
    ({ controls: { integrity: {} }, ...overrides }) as unknown as WindtunnelLock;

  /** An authored lock bound to a substrate's integrity shas. */
  const authoredLock = (prDiffsSha: string, groundTruthSha: string): WindtunnelLock =>
    lock({
      producerKind: 'authored',
      authored: { expectedSplitRef: SPLIT_REF },
      controls: { integrity: { prDiffsSha, groundTruthSha } },
    });

  /** A ScorerInput `base` (exposure floors 0 so a clean run reaches PASS). The authored
   *  closure strips `positiveControlTargets` (Q1 guard); the mined closure keeps it. */
  const baseScorerInput = (over: Partial<ScorerInput>): ScorerInput => ({
    firings: [],
    groundTruth: new Map(),
    positiveControlTargets: [],
    mintedRuleIds: [],
    cullRateThreshold: 0.5,
    exposureFloors: {
      activeRulesEvaluated: 0,
      filesTouchedInWindow: 0,
      positiveControlsExercised: 0,
    },
    actualExposure: {
      activeRulesEvaluated: 1,
      filesTouchedInWindow: 5,
      positiveControlsExercised: 1,
    },
    ...over,
  });

  const firing = (
    ruleId: string,
    pr: number,
    controlKind: RuleFiring['controlKind'],
    matchedLine = 'gen();',
    filePath = 'src/a.ts',
  ): RuleFiring => ({
    ruleId,
    pr,
    filePath,
    matchedLine,
    controlKind,
    labelId: firingLabelId(ruleId, pr, filePath, matchedLine),
  });

  /** Resolve an authored run over a split with held-out prs, then read the minted ruleId
   *  the real corpus derived (the Gate-2 join-back key). */
  const resolveAuthored = async (
    split: SplitArtifact,
  ): Promise<{
    resolved: Awaited<ReturnType<typeof resolveCertifyingCorpusProvider>>;
    ruleId: string;
  }> => {
    writeAuthoredYaml(totemDir);
    const { prDiffsSha, groundTruthSha } = writeSubstrate(gate1Dir, { split });
    const alock = authoredLock(prDiffsSha, groundTruthSha);
    const resolved = await resolveCertifyingCorpusProvider(
      alock,
      inputs({ authoredControlsDeps: diffDeps('differential-holds') }),
    );
    const corpus = await resolved.provider(alock);
    const ruleId = corpus.authoredControls!.positive[0]!.targetRuleId;
    return { resolved, ruleId };
  };

  it('(i) authored happy path: resolve → real scoreAuthoredWindtunnel → PASS + Gate-2 eligible', async () => {
    const split: SplitArtifact = { ...SPLIT, trainPrs: [1], heldOutPrs: [2] };
    const { resolved, ruleId } = await resolveAuthored(split);

    const ctrl = firing(ruleId, 1, 'positive', 'ctrl();'); // train-side positive control
    const heldCorpus = firing(ruleId, 2, 'corpus', 'gen();'); // held-out generalization
    const scored = resolved.score(
      baseScorerInput({
        firings: [ctrl, heldCorpus],
        groundTruth: new Map<string, GroundTruthLabel>([
          [ctrl.labelId, 'TP'],
          [heldCorpus.labelId, 'TP'],
        ]),
        mintedRuleIds: [ruleId],
        positiveControlTargets: [{ pr: 1, targetRuleId: ruleId }],
      }),
    );

    expect(scored.kind).toBe('authored');
    if (scored.kind !== 'authored') throw new Error('unreachable');
    expect(scored.verdict.verdict).toBe('PASS');
    // O3 metric: the held-out corpus firing counts; the train-side control does not.
    expect(scored.verdict.heldOutActivationsByRule).toEqual({ [ruleId]: 1 });
    // Gate-2: a non-disqualified window's survivor with heldOut>0 is eligible (§1(k) satisfied).
    expect(scored.gate2.windowDisqualified).toBe(false);
    expect(scored.gate2.eligibleRuleIds).toEqual([ruleId]);
  });

  it('(ii) no-mint gate FIRES: a would-be-minted rule ⇒ GATE_INVALID at resolve, scorer unreachable, ledger byte-unchanged', async () => {
    writeAuthoredYaml(totemDir); // seeds YAML + ledger (rule → `unchanged` on re-read)
    const { prDiffsSha, groundTruthSha } = writeSubstrate(gate1Dir);
    const ledgerPath = path.join(totemDir, 'spine', 'authoring-ledger.ndjson');
    const ledgerBefore = fs.readFileSync(ledgerPath, 'utf-8');

    // agy's dynamic in-memory mutate: rewrite ONLY the YAML to add a SECOND (unledgered)
    // rule — the cert re-derive would MINT it. Do NOT re-seed the ledger (no runRuleAuthor).
    fs.writeFileSync(
      path.join(totemDir, 'spine', 'authored-rules.yaml'),
      stringify({
        splitRef: SPLIT_REF,
        authoredAfterSplit: true,
        heldOutNonInspectionAttestation: true,
        rules: [
          authoredRuleInput(),
          authoredRuleInput({ targetDefect: 'a SECOND distinct defect' }),
        ],
      }),
      'utf-8',
    );

    // The gate throws during the resolver's EAGER build — before `score` is returned (a
    // stronger guarantee than a scorer spy: the closure never exists to be called).
    await expect(
      resolveCertifyingCorpusProvider(
        authoredLock(prDiffsSha, groundTruthSha),
        inputs({ authoredControlsDeps: diffDeps('differential-holds') }),
      ),
    ).rejects.toThrow(/would be authored \(minted\/revised\)/);

    // §8 no-mint: the cert re-derive is read-only — the gate fired before Pass-2 append.
    expect(fs.readFileSync(ledgerPath, 'utf-8')).toBe(ledgerBefore);
  });

  it('(v) mined path regression: producerKind absent ⇒ kind mined, NO gate2 key, verdict byte-identical to scoreWindtunnel', async () => {
    const resolved = await resolveCertifyingCorpusProvider(lock({}), inputs());

    const ctrl = firing('mined-rule', 1, 'positive', 'ctrl();');
    const base = baseScorerInput({
      firings: [ctrl],
      groundTruth: new Map<string, GroundTruthLabel>([[ctrl.labelId, 'TP']]),
      mintedRuleIds: ['mined-rule'],
      positiveControlTargets: [{ pr: 1, targetRuleId: 'mined-rule' }],
    });
    const scored = resolved.score(base);

    expect(scored.kind).toBe('mined');
    // The mined bundle carries NO Gate-2 surface at all (not an empty one).
    expect('gate2' in scored).toBe(false);
    // Byte-identity: the mined closure is a pass-through to the real scoreWindtunnel.
    expect(scored.verdict).toEqual(scoreWindtunnel(base));
  });

  it('(vi) cross-partition leakage guard: a train-only-activating rule → zero held-out → excluded from Gate-2 despite PASS', async () => {
    const split: SplitArtifact = { ...SPLIT, trainPrs: [1], heldOutPrs: [2] };
    // Structural guard: the partitions the metric keys off are disjoint (heldOut ∩ train = ∅).
    expect(split.heldOutPrs.some((pr) => split.trainPrs.includes(pr))).toBe(false);
    const { resolved, ruleId } = await resolveAuthored(split);

    const ctrl = firing(ruleId, 1, 'positive', 'ctrl();'); // train-side ONLY — no held-out corpus firing
    const scored = resolved.score(
      baseScorerInput({
        firings: [ctrl],
        groundTruth: new Map<string, GroundTruthLabel>([[ctrl.labelId, 'TP']]),
        mintedRuleIds: [ruleId],
        positiveControlTargets: [{ pr: 1, targetRuleId: ruleId }],
      }),
    );

    expect(scored.kind).toBe('authored');
    if (scored.kind !== 'authored') throw new Error('unreachable');
    // Clean rare-defect window: the verdict PASSES…
    expect(scored.verdict.verdict).toBe('PASS');
    expect(scored.verdict.heldOutActivationsByRule).toEqual({ [ruleId]: 0 });
    // …yet Gate-2 excludes the rule (survivor recorded, ineligible at zero held-out).
    expect(scored.gate2.survivors).toEqual([
      { ruleId, heldOutActivations: 0, gate2Eligible: false },
    ]);
    expect(scored.gate2.eligibleRuleIds).toEqual([]);
  });

  it('(vii) unlabeled-demotion partition: held-out UNLABELED corpus firing ⇒ HONEST-NEGATIVE, no FP, metric verdict-inert', async () => {
    const split: SplitArtifact = { ...SPLIT, trainPrs: [1], heldOutPrs: [2] };
    const { resolved, ruleId } = await resolveAuthored(split);

    const ctrl = firing(ruleId, 1, 'positive', 'ctrl();'); // train-side, TP-labeled
    const unlabeled = firing(ruleId, 2, 'corpus', 'gen();'); // held-out, NO ground-truth entry
    const scored = resolved.score(
      baseScorerInput({
        firings: [ctrl, unlabeled],
        groundTruth: new Map<string, GroundTruthLabel>([[ctrl.labelId, 'TP']]),
        mintedRuleIds: [ruleId],
        positiveControlTargets: [{ pr: 1, targetRuleId: ruleId }],
      }),
    );

    expect(scored.kind).toBe('authored');
    if (scored.kind !== 'authored') throw new Error('unreachable');
    // Clean demotion — needs adjudication, NOT a FAIL/FP.
    expect(scored.verdict.verdict).toBe('HONEST-NEGATIVE');
    expect(scored.verdict.needsAdjudication).toContain(unlabeled.labelId);
    expect(scored.gate2.windowDisqualified).toBe(false);
    // The O3 metric is label-independent (verdict-inert): the unlabeled held-out firing still counts.
    expect(scored.verdict.heldOutActivationsByRule).toEqual({ [ruleId]: 1 });
  });

  it('(viii) §6 cull-unbroken: a fix-shaped differential ⇒ positive:[] + illegitimate non-emission ⇒ FAIL, never a mined PASS via empty positives (codex assertion #1)', async () => {
    writeAuthoredYaml(totemDir);
    const split: SplitArtifact = { ...SPLIT, trainPrs: [1], heldOutPrs: [2] };
    const { prDiffsSha, groundTruthSha } = writeSubstrate(gate1Dir, { split });
    const alock = authoredLock(prDiffsSha, groundTruthSha);
    // fix-shaped: the §4 differential culls every fixture to an illegitimate non-emission —
    // NOTHING reaches positive[]. resolveAuthored is not reusable here (it reads positive[0]).
    const resolved = await resolveCertifyingCorpusProvider(
      alock,
      inputs({ authoredControlsDeps: diffDeps('fix-shaped') }),
    );
    const corpus = await resolved.provider(alock);

    // The §6 cull holds end-to-end: a fix-shaped fixture lands in nonEmissions, never positive[].
    expect(corpus.authoredControls!.positive).toEqual([]);
    expect(corpus.authoredControls!.nonEmissions).toHaveLength(1);
    expect(corpus.authoredControls!.nonEmissions[0]!.class).toBe('illegitimate');

    const ruleId = corpus.rules[0]!.lessonHash;
    // The hazard codex assertion #1 guards: an empty positive control MUST NOT let the run
    // degenerate to a mined PASS via positiveControlTargets:[] — the illegitimate non-emission
    // FAILs the whole window. (Core-altitude sibling: windtunnel-scorer-authored.test.ts codex-1.)
    const scored = resolved.score(
      baseScorerInput({
        firings: [],
        groundTruth: new Map(),
        mintedRuleIds: [ruleId],
        positiveControlTargets: [],
      }),
    );

    expect(scored.kind).toBe('authored');
    if (scored.kind !== 'authored') throw new Error('unreachable');
    // NOT a silent mined PASS — a structural, no-claim FAIL (precision null, never 0).
    expect(scored.verdict.verdict).toBe('FAIL');
    expect(scored.verdict.precision).toBeNull();
    expect(scored.verdict.authoredControlGate.illegitimate).toBe(1);
    expect(scored.verdict.authoredControlGate.effect).toBe('fail-illegitimate');
    // Gate-2: illegitimate > 0 ⇒ window disqualified ⇒ no survivor eligible (Q4).
    expect(scored.gate2.windowDisqualified).toBe(true);
    expect(scored.gate2.eligibleRuleIds).toEqual([]);
  });
});

// ─── 7. Slice D5 — the authored materialize/freeze seam (producer → consumer) ──
//
// `materializeAuthored` is the sibling authored producer: it FREEZES the window-wide
// substrate + a `frozenAt` split + the `producerKind:'authored'` lock, gated by the
// §5.1/§5.3 freeze preconditions. Git is injected so the producer is exercised without
// a real clone (the mined materializer has no unit test at all). Row (i) closes the
// producer→consumer loop: the PRODUCED lock+substrate drives a real authored resolve.

describe('ADR-112 D5 — materializeAuthored (authored producer)', () => {
  const AUTHORED_AT = '2026-06-15T12:00:00.000Z';
  const FROZEN_AT = '2026-06-01T00:00:00.000Z'; // strictly BEFORE authoring (Q3 temporal)

  let repoRoot: string;
  let gate1Dir: string;
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-d5-repo-'));
    gate1Dir = path.join(repoRoot, 'gate-1');
  });
  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  /** Newest-first metas for PRs 2,1 → corpus [1,2] (all code-touching non-bot). */
  const metas = (): PrMeta[] =>
    [2, 1].map((pr) => ({
      pr,
      mergeCommit: sha(pr),
      author: 'Dev <dev@example.com>',
      isBotAuthor: false,
      changedFiles: ['src/a.ts'],
    }));

  /** An authored seed: producerKind authored, cutIndex 1 ⇒ train [1] / held-out [2] (floor 0.5). */
  const authoredSeed = (over: Partial<CertCorpusSeed> = {}): CertCorpusSeed =>
    CertCorpusSeedSchema.parse({
      producerKind: 'authored',
      gate: 'gate-1',
      canonicalPath: 'gate-1/windtunnel.lock.json',
      repo: 'mmnto-ai/liquid-city',
      phase: 'certifying',
      selectionRule: {
        state: 'merged',
        predicate: 'code-touching non-bot',
        window: { type: 'all' },
        asOfCommit: sha(999),
        codePathClassifier: { includeGlobs: ['**'], excludeGlobs: [] },
      },
      split: { cutIndex: 1, excludedPrs: [], frozenAt: FROZEN_AT },
      controls: {
        positiveRef: 'gate-1/controls/positive',
        negativeRef: 'gate-1/controls/negative',
        mechanism: 'git-hash-object',
        positive: [], // authored controls are train-side (derived at run), NOT seed-designated
        negative: [],
      },
      fpDefinition: { rubricRef: 'r', groundTruthRef: 'g', adjudicator: 'disposition-derived' },
      cullRateThreshold: 0.1,
      exposureDenominator: {
        activeRulesEvaluated: { floor: 2 },
        filesTouchedInWindow: { floor: 0 },
        positiveControlsExercised: { floor: 0 },
      },
      ...over,
    });

  const ctx = (seed: CertCorpusSeed) => ({
    seed,
    lcDir: '/unused-git-injected',
    repoRoot,
    cwd: repoRoot,
    totemDir,
    outDir: gate1Dir,
    resolveWithinRepo: (input: string) => path.resolve(repoRoot, input),
    safeExec: (() => {
      throw new Error('git must be injected');
    }) as never,
  });

  /** Injected git: canned metas + non-empty diffs + a fixed fixtureSha. No `now` — `frozenAt` is
   *  the seed's recorded pre-authoring instant (real chronology), never a materialize clock. */
  const gitDeps = (over: Partial<Parameters<typeof materializeAuthored>[1]> = {}) => ({
    enumerateMetas: () => metas(),
    resolvePrDiff: (mergeCommit: string) => ({
      baseSha: sha(500),
      headSha: sha(600),
      diff: `diff ${mergeCommit}\n+forbiddenCall()\n`,
    }),
    computeControlFixtureSha: () => sha(7),
    ...over,
  });

  it('(i) produces a valid authored lock + window-wide substrate + frozenAt split', async () => {
    writeAuthoredYaml(totemDir, {
      rules: [authoredRuleInput({ authoredAt: AUTHORED_AT, positiveFixtures: [posFixture(1)] })],
    });
    await materializeAuthored(ctx(authoredSeed()), gitDeps());

    // Lock: parses, producerKind authored, expectedSplitRef = the ledger's splitRef, no groundTruthSha.
    const lockRaw = JSON.parse(
      fs.readFileSync(path.join(gate1Dir, 'windtunnel.lock.json'), 'utf-8'),
    );
    const lock = WindtunnelLockSchema.parse(lockRaw);
    expect(lock.producerKind).toBe('authored');
    expect(lock.authored).toEqual({ expectedSplitRef: SPLIT_REF });
    expect(lock.controls.integrity.groundTruthSha).toBeUndefined(); // derive-labels stamps it

    // Split: carries the mechanical frozenAt; train [1] / held-out [2].
    const split = JSON.parse(fs.readFileSync(path.join(gate1Dir, 'split.json'), 'utf-8'));
    expect(split.frozenAt).toBe(FROZEN_AT);
    expect(split.trainPrs).toEqual([1]);
    expect(split.heldOutPrs).toEqual([2]);

    // pr-diffs: WINDOW-WIDE (train ∪ held-out = [1,2]), not held-out-only.
    const prDiffs = JSON.parse(fs.readFileSync(path.join(gate1Dir, 'pr-diffs.json'), 'utf-8'));
    expect(prDiffs.map((d: { pr: number }) => d.pr)).toEqual([1, 2]);

    // The train-side positive-control fixture diff was written for the integrity gate.
    expect(fs.existsSync(path.join(repoRoot, 'gate-1/controls/positive/1.diff'))).toBe(true);
  });

  it('(i-consumer) the PRODUCED lock+substrate drives a real authored resolve (producer→consumer)', async () => {
    writeAuthoredYaml(totemDir, {
      rules: [authoredRuleInput({ authoredAt: AUTHORED_AT, positiveFixtures: [posFixture(1)] })],
    });
    await materializeAuthored(ctx(authoredSeed()), gitDeps());

    // Simulate the `derive-labels` seal: write the answer key + stamp groundTruthSha onto the lock.
    const gtJson = JSON.stringify({});
    fs.writeFileSync(path.join(gate1Dir, 'ground-truth-labels.json'), gtJson, 'utf-8');
    const groundTruthSha = createHash('sha256')
      .update(gtJson.replace(/\r\n/g, '\n'), 'utf-8')
      .digest('hex');
    const lock = WindtunnelLockSchema.parse(
      JSON.parse(fs.readFileSync(path.join(gate1Dir, 'windtunnel.lock.json'), 'utf-8')),
    );
    const sealedLock = {
      ...lock,
      controls: {
        ...lock.controls,
        integrity: { ...lock.controls.integrity, groundTruthSha },
      },
    } as WindtunnelLock;

    const { provider, score } = await resolveCertifyingCorpusProvider(sealedLock, {
      gate1Dir,
      stage4: stage4(),
      now: NOW,
      totemDir,
      authoredControlsDeps: diffDeps('differential-holds'),
    });
    const corpus = await provider(sealedLock);
    // The authored channel resolved from the PRODUCED substrate (fixture #1 is train-side positive).
    expect(corpus.authoredControls).toBeDefined();
    expect(corpus.authoredControls!.positive).toHaveLength(1);
    expect(score).toBeTypeOf('function');
  });

  it('(ii) temporal violation: seed frozenAt AFTER authoring ⇒ GATE_INVALID, nothing written', async () => {
    // A real (undoctored) run: the seed's recorded frozenAt post-dates the rule's authoredAt, so
    // the split was NOT frozen before authoring — a §5.1 leakage event the gate must reject.
    writeAuthoredYaml(totemDir, {
      rules: [authoredRuleInput({ authoredAt: AUTHORED_AT, positiveFixtures: [posFixture(1)] })],
    });
    const lateSeed = authoredSeed({
      split: { cutIndex: 1, excludedPrs: [], frozenAt: '2026-06-20T00:00:00.000Z' },
    });
    await expect(materializeAuthored(ctx(lateSeed), gitDeps())).rejects.toThrow(/Q3 temporal/);
    // Nothing written: the freeze gate throws BEFORE gate1Dir is created (CR — no partial write).
    expect(fs.existsSync(gate1Dir)).toBe(false);
  });

  it('(vii) absent seed frozenAt ⇒ fail-loud (materialize never stamps its own clock)', async () => {
    // The production-honesty guard (#2287 couple HOLD): with no recorded pre-authoring freeze
    // instant, materialize MUST fail loud — never fall back to a materialize-`now()` freeze.
    writeAuthoredYaml(totemDir, {
      rules: [authoredRuleInput({ authoredAt: AUTHORED_AT, positiveFixtures: [posFixture(1)] })],
    });
    const noFreezeSeed = authoredSeed({ split: { cutIndex: 1, excludedPrs: [] } });
    await expect(materializeAuthored(ctx(noFreezeSeed), gitDeps())).rejects.toThrow(
      /frozen BEFORE authoring/,
    );
    expect(fs.existsSync(gate1Dir)).toBe(false);
  });

  it('(v) Q2 floor violation: held-out < 50% of the window ⇒ GATE_INVALID', async () => {
    // corpus [1,2,3], cutIndex 2 ⇒ train [1,2] / held-out [3] ⇒ 1/3 < 0.5.
    const threeMetas: PrMeta[] = [3, 2, 1].map((pr) => ({
      pr,
      mergeCommit: sha(pr),
      author: 'Dev <dev@example.com>',
      isBotAuthor: false,
      changedFiles: ['src/a.ts'],
    }));
    writeAuthoredYaml(totemDir, {
      rules: [authoredRuleInput({ authoredAt: AUTHORED_AT, positiveFixtures: [posFixture(1)] })],
    });
    await expect(
      materializeAuthored(
        ctx(authoredSeed({ split: { cutIndex: 2, excludedPrs: [], frozenAt: FROZEN_AT } })),
        gitDeps({ enumerateMetas: () => threeMetas }),
      ),
    ).rejects.toThrow(/Q2 held-out floor/);
    expect(fs.existsSync(gate1Dir)).toBe(false);
  });

  it('(iii) membership violation: a held-out positive fixture ⇒ GATE_INVALID naming the PR', async () => {
    // fixture pr=2 is the HELD-OUT slice ⇒ §5(2) leakage.
    writeAuthoredYaml(totemDir, {
      rules: [authoredRuleInput({ authoredAt: AUTHORED_AT, positiveFixtures: [posFixture(2)] })],
    });
    await expect(materializeAuthored(ctx(authoredSeed()), gitDeps())).rejects.toThrow(
      /Q3 membership.*#2/s,
    );
    expect(fs.existsSync(gate1Dir)).toBe(false);
  });
});
