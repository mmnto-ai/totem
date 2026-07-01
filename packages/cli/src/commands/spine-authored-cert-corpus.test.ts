import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import type {
  AuthoredControlsDeps,
  PreimageDifferentialOutcome,
  PreimageDifferentialResult,
  SplitArtifact,
  Stage4VerifierDeps,
  WindtunnelLock,
} from '@mmnto/totem';

import { runRuleAuthor } from '../authored-rule-intake.js';
import {
  buildAuthoredCertifyingCorpus,
  type BuildAuthoredCertifyingCorpusDeps,
} from './spine-authored-cert-corpus.js';
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
