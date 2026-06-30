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

import {
  buildAuthoredCertifyingCorpus,
  type BuildAuthoredCertifyingCorpusDeps,
} from './spine-authored-cert-corpus.js';
import {
  type ReplayCorpusProviderOptions,
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
    judgedBy: JUDGED_BY,
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

// ─── 4. Single-home dispatch (provider resolution off lock.producerKind) ──────

describe('resolveCertifyingCorpusProvider — producerKind dispatch', () => {
  const lockWith = (producerKind?: 'mined' | 'authored'): WindtunnelLock =>
    ({ producerKind }) as unknown as WindtunnelLock;
  const replayOpts: ReplayCorpusProviderOptions = {
    gate1Dir: 'unused',
    stage4: stage4(),
    now: NOW,
  };

  it('a mined lock (explicit or absent) resolves WITHOUT authored deps', () => {
    expect(() =>
      resolveCertifyingCorpusProvider(lockWith('mined'), { replay: replayOpts }),
    ).not.toThrow();
    expect(() =>
      resolveCertifyingCorpusProvider(lockWith(undefined), { replay: replayOpts }),
    ).not.toThrow();
  });

  it('an authored lock without authored deps fails loud (the D2 boundary)', () => {
    expect(() =>
      resolveCertifyingCorpusProvider(lockWith('authored'), { replay: replayOpts }),
    ).toThrow(/Slice D2/);
  });

  it('an authored lock + authored deps selects the authored provider (yields an authored corpus)', async () => {
    writeAuthoredYaml(totemDir);
    const provider = resolveCertifyingCorpusProvider(lockWith('authored'), {
      replay: replayOpts,
      authored: baseDeps(totemDir),
    });
    const corpus = await provider(lockWith('authored'));
    expect(corpus.authoredControls).toBeDefined();
    expect(corpus.authoredControls!.positive).toHaveLength(1);
  });
});
