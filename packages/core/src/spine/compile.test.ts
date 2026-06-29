import { describe, expect, it, vi } from 'vitest';

import { type AuthoredRuleRecord, mintAuthoredRuleId, toCompileFeed } from './authored-rule.js';
import type { CandidateRuleRecord, CompileInputCandidate } from './candidate-rule.js';
import {
  type ClassifierResult,
  type ClassifyStageResult,
  type DraftClassifier,
  runClassifyStage,
} from './classify.js';
import {
  compileCandidate,
  type CompiledCandidate,
  type CompileStageDeps,
  runCompileStage,
} from './compile.js';
import type { DraftCandidate, ExtractStageResult } from './extract.js';
import type { MinerLedgers, SplitLedger } from './ledgers.js';
import { runFalsificationHarness } from './miner-harness.js';

// The frozen LessonInput actuator is wrapped in spies so the call-spy test (agy
// fold-1) can assert the G-series path NEVER touches it. `validateAstGrepPattern`
// (the one symbol compile.ts imports from this module) is preserved via `...actual`.
vi.mock('../compile-lesson.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../compile-lesson.js')>();
  return {
    ...actual,
    compileLesson: vi.fn(actual.compileLesson),
    buildCompiledRule: vi.fn(actual.buildCompiledRule),
    buildManualRule: vi.fn(actual.buildManualRule),
  };
});
import * as frozenActuator from '../compile-lesson.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const NOW = '2026-06-19T12:00:00.000Z';

// ── dslSource fixtures (lesson-markdown bodies the slice-2/3 format produces) ──

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

// Same pattern, severity error — used to prove candidate-debt FORCES warning.
const REGEX_DSL_ERROR = REGEX_DSL.replace('**Severity:** warning', '**Severity:** error');

// A ReDoS-unsafe pattern — `validateRegex` rejects → compile-rejected.
const REDOS_DSL = ['**Pattern:** `(a+)+$`', '**Engine:** regex'].join('\n');

// engine: ast (tree-sitter query) — no ReDoS validator, so it compiles; used to
// exercise the workingDirectory guard without the ast-grep napi parser.
const AST_DSL = ['**Pattern:** `(call_expression)`', '**Engine:** ast'].join('\n');

// A compound ast-grep yaml rule — parse-fidelity check for the yaml engine.
const ASTGREP_YAML_DSL = [
  '**Engine:** ast-grep',
  '**Pattern:**',
  '```yaml',
  'rule:',
  '  pattern: console.log($MSG)',
  '```',
].join('\n');

// No `**Pattern:**` — `extractManualPattern` returns null (a structural candidate
// here is a producer-contract violation: slice-2 preflight should have dropped it).
const NO_PATTERN_DSL = 'Prefer composition over inheritance — a behavioral note.';

// ── Builders ──────────────────────────────────────────────────────────────────

function candidateRule(
  pr: number,
  dslSource: string,
  disposition: 'structural' | 'behavioral' = 'structural',
  ordinal = 0,
): CandidateRuleRecord {
  return {
    provenance: { mergedPr: pr, reviewThread: `rt-${pr}`, commitSha: sha(pr) },
    classifierDisposition: disposition,
    classifierLedgerRef: `clr-${pr}-${ordinal}`,
    dslSource,
    unverified: true,
  };
}

/** A minimal ClassifyStageResult with emission + classifier ledgers consistent with the candidates. */
function classifyResultOf(candidates: CandidateRuleRecord[]): ClassifyStageResult {
  return {
    candidates,
    emissionLedger: {
      entries: candidates.map((c, i) => ({
        candidateRef: `cand-${c.provenance.mergedPr}-${i}`,
        provenance: c.provenance,
        classifierDisposition: c.classifierDisposition,
        routing: c.classifierDisposition === 'structural' ? 'compile' : 'rag-only',
        classifierLedgerRef: c.classifierLedgerRef,
        unverified: true,
      })),
      extractionInputsAttestation: { seedClassesProvided: false },
    },
    classifierLedger: {
      entries: candidates.map((c) => ({
        candidateRef: c.classifierLedgerRef,
        disposition: c.classifierDisposition,
        stage4Confirmed: false,
        dispositionSource: 'classified' as const,
      })),
    },
  };
}

/** Stage-4 deps backed by an in-memory file map. `readFile` rejects for a listed-but-absent file. */
function compileDeps(
  files: Record<string, string>,
  overrides: Partial<CompileStageDeps> = {},
): CompileStageDeps {
  return {
    now: NOW,
    stage4: {
      listFiles: () => Promise.resolve(Object.keys(files)),
      readFile: (f: string) =>
        f in files ? Promise.resolve(files[f] as string) : Promise.reject(new Error(`absent ${f}`)),
      ...overrides.stage4,
    },
    ...('baseline' in overrides ? { baseline: overrides.baseline } : {}),
    ...('now' in overrides ? { now: overrides.now } : {}),
  };
}

const single = (dsl: string, disp: 'structural' | 'behavioral' = 'structural') =>
  classifyResultOf([candidateRule(1, dsl, disp)]);

// ── compileCandidate (pure) ─────────────────────────────────────────────────

describe('compileCandidate', () => {
  it('compiles a regex structural candidate: unverified, no legitimacy/ruleClass/manual, injected now', () => {
    const out = compileCandidate(candidateRule(1, REGEX_DSL), { now: NOW });
    expect(out.kind).toBe('compiled');
    if (out.kind !== 'compiled') throw new Error('unreachable');
    const { rule } = out;
    expect(rule.engine).toBe('regex');
    expect(rule.pattern).toBe('forbiddenCall\\(');
    expect(rule.unverified).toBe(true);
    expect(rule.legitimacy).toBeUndefined();
    expect(rule.ruleClass).toBeUndefined();
    expect(rule.manual).toBeUndefined();
    expect(rule.badExample).toBe('forbiddenCall()');
    expect(rule.compiledAt).toBe(NOW);
    expect(rule.createdAt).toBe(NOW);
    expect(rule.lessonHeading).toBe('Gate-1 rule candidate (clr-1-0)');
  });

  it('throws on a behavioral candidate (FM(c) code backstop)', () => {
    expect(() => compileCandidate(candidateRule(1, REGEX_DSL, 'behavioral'), { now: NOW })).toThrow(
      /behavioral candidate .* must never be compiled/,
    );
  });

  it('throws on a structural candidate with no usable pattern (preflight↔parser desync)', () => {
    expect(() => compileCandidate(candidateRule(1, NO_PATTERN_DSL), { now: NOW })).toThrow(
      /no usable pattern/,
    );
  });

  it('rejects (not throws) a ReDoS-unsafe regex → compile-rejected', () => {
    const out = compileCandidate(candidateRule(1, REDOS_DSL), { now: NOW });
    expect(out.kind).toBe('rejected');
  });

  it('parses a compound ast-grep yaml rule (engine ast-grep, astGrepYamlRule populated)', () => {
    const out = compileCandidate(candidateRule(1, ASTGREP_YAML_DSL), { now: NOW });
    expect(out.kind).toBe('compiled');
    if (out.kind !== 'compiled') throw new Error('unreachable');
    expect(out.rule.engine).toBe('ast-grep');
    expect(out.rule.astGrepYamlRule).toBeDefined();
    expect(out.rule.pattern).toBe('');
  });
});

// ── runCompileStage — the four Stage-4 outcome maps (regex, deterministic) ────

describe('runCompileStage — Stage-4 outcome → status/ledger maps', () => {
  it('in-scope-bad-example → active/high/confirmed', async () => {
    const r = await runCompileStage(
      single(REGEX_DSL),
      compileDeps({ 'src/a.ts': 'forbiddenCall()' }),
    );
    expect(r.compiled).toHaveLength(1);
    expect(r.compiled[0]?.stage4.outcome).toBe('in-scope-bad-example');
    expect(r.compiled[0]?.rule.status).toBe('active');
    expect(r.compiled[0]?.rule.confidence).toBe('high');
    expect(r.classifierLedger.entries[0]?.stage4Confirmed).toBe(true);
    expect(r.classifierLedger.entries[0]?.stage4Outcome).toBe('confirmed');
  });

  it('candidate-debt → active, severity FORCED to warning, confirmed', async () => {
    const r = await runCompileStage(
      single(REGEX_DSL_ERROR),
      compileDeps({ 'src/a.ts': 'forbiddenCall(x)' }),
    );
    expect(r.compiled[0]?.stage4.outcome).toBe('candidate-debt');
    expect(r.compiled[0]?.rule.status).toBe('active');
    expect(r.compiled[0]?.rule.severity).toBe('warning'); // forced down from error
    expect(r.classifierLedger.entries[0]?.stage4Outcome).toBe('confirmed');
  });

  it('no-matches → untested-against-codebase, not confirmed', async () => {
    const r = await runCompileStage(
      single(REGEX_DSL),
      compileDeps({ 'src/a.ts': 'const ok = 1;' }),
    );
    expect(r.compiled[0]?.stage4.outcome).toBe('no-matches');
    expect(r.compiled[0]?.rule.status).toBe('untested-against-codebase');
    expect(r.classifierLedger.entries[0]?.stage4Confirmed).toBe(false);
    expect(r.classifierLedger.entries[0]?.stage4Outcome).toBe('untested-no-matches');
  });

  it('out-of-scope (fires on a baseline file) → archived, archivedAt=now, not confirmed', async () => {
    const r = await runCompileStage(
      single(REGEX_DSL),
      compileDeps({ 'src/a.test.ts': 'forbiddenCall()' }),
    );
    expect(r.compiled[0]?.stage4.outcome).toBe('out-of-scope');
    expect(r.compiled[0]?.rule.status).toBe('archived');
    expect(r.compiled[0]?.rule.archivedAt).toBe(NOW);
    expect(r.compiled[0]?.rule.archivedReason).toMatch(/stage4-out-of-scope-match/);
    expect(r.classifierLedger.entries[0]?.stage4Outcome).toBe('archived-out-of-scope');
  });
});

// ── runCompileStage — routing, rejection, ledger join, fail-loud ──────────────

describe('runCompileStage — selection, rejection & fail-loud', () => {
  it('compiles only structural; skips behavioral (untouched ledger entry)', async () => {
    const cls = classifyResultOf([
      candidateRule(1, REGEX_DSL, 'structural'),
      candidateRule(2, 'prefer X over Y', 'behavioral'),
    ]);
    const r = await runCompileStage(cls, compileDeps({ 'src/a.ts': 'forbiddenCall()' }));
    expect(r.compiled).toHaveLength(1);
    expect(r.compiled[0]?.classifierLedgerRef).toBe('clr-1-0');
    const behavioral = r.classifierLedger.entries.find((e) => e.candidateRef === 'clr-2-0');
    expect(behavioral?.stage4Confirmed).toBe(false);
    expect(behavioral?.stage4Outcome).toBeUndefined(); // never compiled
  });

  it('records compile-rejected on the ledger and emits no CompiledCandidate', async () => {
    const r = await runCompileStage(single(REDOS_DSL), compileDeps({ 'src/a.ts': 'aaaa' }));
    expect(r.compiled).toHaveLength(0);
    expect(r.classifierLedger.entries[0]?.stage4Confirmed).toBe(false);
    expect(r.classifierLedger.entries[0]?.stage4Outcome).toBe('compile-rejected');
  });

  it('fails loud when a structural candidate has no matching classifier-ledger entry', async () => {
    const cls = single(REGEX_DSL);
    cls.classifierLedger.entries = []; // drop the join target
    await expect(runCompileStage(cls, compileDeps({}))).rejects.toThrow(
      /matches 0 classifier-ledger entries/,
    );
  });

  it('fails loud on a duplicate classifier-ledger ref', async () => {
    const cls = single(REGEX_DSL);
    cls.classifierLedger.entries.push({ ...cls.classifierLedger.entries[0]! });
    await expect(
      runCompileStage(cls, compileDeps({ 'src/a.ts': 'forbiddenCall()' })),
    ).rejects.toThrow(/matches 2 classifier-ledger entries/);
  });

  it('throws on an ast rule without a workingDirectory (never degrades to no-matches)', async () => {
    await expect(
      runCompileStage(single(AST_DSL), compileDeps({ 'src/a.ts': 'x' })),
    ).rejects.toThrow(/requires deps\.stage4\.workingDirectory/);
  });

  it('throws on an ast-grep rule without a workingDirectory too (both tree-sitter engines)', async () => {
    await expect(
      runCompileStage(single(ASTGREP_YAML_DSL), compileDeps({ 'src/a.ts': 'x' })),
    ).rejects.toThrow(/requires deps\.stage4\.workingDirectory/);
  });

  it('propagates a readFile failure loudly, preserving the original cause', async () => {
    const deps: CompileStageDeps = {
      now: NOW,
      stage4: {
        listFiles: () => Promise.resolve(['src/a.ts']),
        readFile: () => Promise.reject(new Error('disk gone')),
      },
    };
    // compile.ts owns "no swallowing catch" — assert the ORIGINAL error survives as
    // the cause, not the verifier's wrapper message (which compile.ts does not own).
    const err = await runCompileStage(single(REGEX_DSL), deps).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(((err as Error).cause as Error).message).toBe('disk gone');
  });

  it('throws directly on a behavioral candidate handed to compileCandidate via the stage too', async () => {
    // runCompileStage filters behavioral out, but compileCandidate is the FM(c) backstop.
    expect(() =>
      compileCandidate(candidateRule(9, REGEX_DSL, 'behavioral'), { now: NOW }),
    ).toThrow();
  });
});

// ── Determinism + provenance handoff ──────────────────────────────────────────

describe('runCompileStage — determinism & handoff', () => {
  it('is deterministic: identical inputs + fixed now/deps → identical output', async () => {
    const files = { 'src/b.ts': 'forbiddenCall(y)', 'src/a.ts': 'forbiddenCall()' };
    const a = await runCompileStage(single(REGEX_DSL), compileDeps(files));
    const b = await runCompileStage(single(REGEX_DSL), compileDeps(files));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('carries provenance forward un-projected onto the CompiledCandidate', async () => {
    const r = await runCompileStage(
      single(REGEX_DSL),
      compileDeps({ 'src/a.ts': 'forbiddenCall()' }),
    );
    const cc: CompiledCandidate | undefined = r.compiled[0];
    expect(cc?.provenance).toEqual({ mergedPr: 1, reviewThread: 'rt-1', commitSha: sha(1) });
    expect(cc?.rule.legitimacy).toBeUndefined(); // slice-5 stamps it
  });

  it('never calls the frozen LessonInput actuator (compileLesson/buildCompiledRule/buildManualRule)', async () => {
    await runCompileStage(single(REGEX_DSL), compileDeps({ 'src/a.ts': 'forbiddenCall()' }));
    expect(vi.mocked(frozenActuator.compileLesson)).not.toHaveBeenCalled();
    expect(vi.mocked(frozenActuator.buildCompiledRule)).not.toHaveBeenCalled();
    expect(vi.mocked(frozenActuator.buildManualRule)).not.toHaveBeenCalled();
  });
});

// ── End-to-end harness lock (real classify → compile → §8 harness green) ──────

const asStructural: ClassifierResult = {
  disposition: 'structural',
  dispositionSource: 'classified',
};
const structuralClassifier: DraftClassifier = { classify: () => Promise.resolve(asStructural) };

function draft(pr: number, dslSource: string): DraftCandidate {
  return {
    provenance: { mergedPr: pr, reviewThread: `rt-${pr}`, commitSha: sha(pr) },
    dslSource,
    sourceKind: 'human',
  };
}

function extractResultOf(drafts: DraftCandidate[]): ExtractStageResult {
  const prs = [...new Set(drafts.map((d) => d.provenance.mergedPr))].sort((a, b) => a - b);
  return {
    drafts,
    dropLedger: { entries: [] },
    apiUsageLedger: {
      entries: prs.map((pr) => ({
        targetPr: pr,
        slice: 'train' as const,
        fetchKind: 'review-thread',
      })),
      heldOutFetchCount: 0,
    },
    seedBlindness: { seedClassesProvided: false },
  };
}

function splitLedgerFixture(): SplitLedger {
  return {
    split: {
      asOfCommit: sha(100),
      trainPrs: [1, 2],
      heldOutPrs: [3, 4],
      excludedPrs: [],
      positiveControlPrs: [3],
      negativeControlPrs: [4],
      splitRule: { predicate: 'code-touching non-bot', cutIndex: 2 },
    },
    corpus: [1, 2, 3, 4],
    corpusMergeCommits: [1, 2, 3, 4].map((pr) => ({ pr, mergeCommit: sha(pr) })),
  };
}

describe('runCompileStage — end-to-end §8 harness lock', () => {
  it('real classify → compile output passes runFalsificationHarness green', async () => {
    const extract = extractResultOf([draft(1, REGEX_DSL), draft(2, REGEX_DSL)]);
    const split = splitLedgerFixture();
    const classify = await runClassifyStage(extract, split, { classifier: structuralClassifier });
    const compileRes = await runCompileStage(
      classify,
      compileDeps({ 'src/a.ts': 'forbiddenCall()' }),
    );

    const ledgers: MinerLedgers = {
      emission: classify.emissionLedger,
      drop: extract.dropLedger,
      classifier: compileRes.classifierLedger, // the COMPILE-UPDATED ledger
      split,
      apiUsage: extract.apiUsageLedger,
    };
    const result = runFalsificationHarness(ledgers);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    // both train PRs confirmed-active
    expect(compileRes.compiled).toHaveLength(2);
    expect(compileRes.classifierLedger.entries.every((e) => e.stage4Outcome === 'confirmed')).toBe(
      true,
    );
  });

  it('a desynced stage4Confirmed vs stage4Outcome trips the consistency guard', async () => {
    const extract = extractResultOf([draft(1, REGEX_DSL), draft(2, REGEX_DSL)]);
    const split = splitLedgerFixture();
    const classify = await runClassifyStage(extract, split, { classifier: structuralClassifier });
    const compileRes = await runCompileStage(
      classify,
      compileDeps({ 'src/a.ts': 'forbiddenCall()' }),
    );
    // Forge a desync: a confirmed outcome whose stage4Confirmed is flipped to false.
    compileRes.classifierLedger.entries[0]!.stage4Confirmed = false;
    const ledgers: MinerLedgers = {
      emission: classify.emissionLedger,
      drop: extract.dropLedger,
      classifier: compileRes.classifierLedger,
      split,
      apiUsage: extract.apiUsageLedger,
    };
    const clauses = runFalsificationHarness(ledgers).violations.map((v) => v.clause);
    expect(clauses).toContain('stage4-consistency');
  });
});

// ── runCompileStage — ADR-112 authored compile-feed (one compiler, two producers) ──
describe('runCompileStage — ADR-112 authored compile-feed', () => {
  const authored = (ref: string, dsl: string): AuthoredRuleRecord => ({
    ruleId: mintAuthoredRuleId('totem-claude', ref, new Set()),
    provenance: {
      kind: 'authored',
      author: 'totem-claude',
      authoredAt: '2026-06-27',
      targetDefect: 'calls forbiddenCall()',
      positiveFixtures: [
        {
          pr: 1,
          preimageSource: {
            kind: 'commit' as const,
            preimageCommitSha: sha(2),
            mergeCommitSha: sha(1),
          },
          filePath: 'src/a.ts',
          matchedSpan: 'L1',
          contentHash: 'h1',
        },
      ],
    },
    structuralEligibility: {
      decidable: true,
      basis: 'whitelist:forbidden-call',
      judgedBy: 'static-whitelist@cert-1',
    },
    origin: { kind: 'from-scratch' },
    declaredEngine: 'regex',
    authoringLedgerRef: ref,
    dslSource: dsl,
    unverified: true,
  });

  it('compiles an authored rule through the SAME runCompileStage — authored provenance + Stage-4 preserved', async () => {
    const feed = toCompileFeed([authored('alr-1', REGEX_DSL)]);
    const r = await runCompileStage(feed, compileDeps({ 'src/a.ts': 'forbiddenCall()' }));
    expect(r.compiled).toHaveLength(1);
    const c = r.compiled[0]!;
    // authored provenance survives the compiler untouched (the union, not a mined shape).
    expect(c.provenance.kind).toBe('authored');
    expect(c.classifierLedgerRef).toBe('authored:alr-1');
    // Stage-4 actually ran on the authored rule's matcher (real codebase evidence).
    expect(c.stage4.outcome).toBe('in-scope-bad-example');
    // the ledger records the authored-whitelist source + the Stage-4 confirmation.
    expect(r.classifierLedger.entries[0]!.dispositionSource).toBe('authored-whitelist');
    expect(r.classifierLedger.entries[0]!.stage4Confirmed).toBe(true);
  });

  it('never reaches the compiler for a non-decidable authored rule (toCompileFeed throws first)', () => {
    const nd: AuthoredRuleRecord = {
      ...authored('alr-x', REGEX_DSL),
      structuralEligibility: { decidable: false, basis: 'whitelist:x', judgedBy: 's' },
    };
    expect(() => toCompileFeed([nd])).toThrow(/not structurally decidable/);
  });

  it('fails loud when the compiled engine disagrees with the whitelisted declaredEngine (#2259/#7)', async () => {
    // declaredEngine 'ast' was whitelisted, but the dslSource parses as regex — the compiler
    // must not emit it under an engine the eligibility check never cleared.
    const feed = toCompileFeed([
      { ...authored('alr-eng', REGEX_DSL), declaredEngine: 'ast' as const },
    ]);
    await expect(
      runCompileStage(feed, compileDeps({ 'src/a.ts': 'forbiddenCall()' })),
    ).rejects.toThrow(/declared engine 'ast' but its dslSource compiled as 'regex'/);
  });

  it('fails loud on two structural candidates sharing one classifierLedgerRef (#2259 greptile-P1)', async () => {
    const base = toCompileFeed([authored('dup', REGEX_DSL)]);
    // Two candidates, ONE ledger entry: each would pass the exactly-one-entry join, then the
    // later Stage-4 update would overwrite the earlier — the dedup guard rejects it up front.
    const feed: CompileInputCandidate[] = [base.candidates[0]!, base.candidates[0]!];
    await expect(
      runCompileStage(
        { ...base, candidates: feed },
        compileDeps({ 'src/a.ts': 'forbiddenCall()' }),
      ),
    ).rejects.toThrow(/duplicate classifierLedgerRef/);
  });

  // ── ADR-112 §8/§9 id-unification: firingLabelId ← ruleId (slice C2a) ──
  it('threads the persisted ruleId onto the compiled identity (lessonHash ← ruleId), not the dslSource hash', async () => {
    const rec = authored('alr-id', REGEX_DSL);
    const r = await runCompileStage(
      toCompileFeed([rec]),
      compileDeps({ 'src/a.ts': 'forbiddenCall()' }),
    );
    // The compiled rule's identity IS the minted ruleId — the wind-tunnel firingLabelId
    // embeds it, and controls.positive[].targetRuleId joins on it (§6/§8).
    expect(r.compiled[0]!.rule.lessonHash).toBe(rec.ruleId);
  });

  it('keeps the authored identity STABLE across a dslSource (matcher) edit — §8 no-orphan', () => {
    // Same author + targetDefect → same minted ruleId; only the matcher changes.
    const REGEX_DSL_EDITED = REGEX_DSL.replace('forbiddenCall\\(', 'forbiddenCall2\\(');
    const before = authored('alr-stable', REGEX_DSL);
    const after = authored('alr-stable', REGEX_DSL_EDITED);
    expect(after.ruleId).toBe(before.ruleId); // the id does NOT derive from dslSource
    const compiledBefore = compileCandidate(toCompileFeed([before]).candidates[0]!, { now: NOW });
    const compiledAfter = compileCandidate(toCompileFeed([after]).candidates[0]!, { now: NOW });
    expect(compiledBefore.kind).toBe('compiled');
    expect(compiledAfter.kind).toBe('compiled');
    if (compiledBefore.kind === 'compiled' && compiledAfter.kind === 'compiled') {
      // A tightened matcher never orphans the rule's ground-truth labels / controls —
      // the §8 reason dslSource is excluded from identity.
      expect(compiledBefore.rule.lessonHash).toBe(before.ruleId);
      expect(compiledAfter.rule.lessonHash).toBe(before.ruleId);
    }
  });

  it('round-trips a collision-suffixed ruleId (-N) onto the identity verbatim', () => {
    // A second rule by one author on one targetDefect mints `<seed>-1` (§8 disambiguation);
    // the suffix must survive onto lessonHash so distinct matchers never share a firing key.
    const rec: AuthoredRuleRecord = {
      ...authored('alr-collide', REGEX_DSL),
      ruleId: '0123456789abcdef-1',
    };
    const out = compileCandidate(toCompileFeed([rec]).candidates[0]!, { now: NOW });
    expect(out.kind).toBe('compiled');
    if (out.kind === 'compiled') expect(out.rule.lessonHash).toBe('0123456789abcdef-1');
  });

  it('leaves a MINED rule keyed on the content hash (no ruleId → dslSource-derived), unchanged', () => {
    // The unification is authored-only: a mined candidate carries no ruleId, so its identity
    // stays the content hash — byte-identical to pre-C2a, and never the authored ruleId.
    const out = compileCandidate(candidateRule(1, REGEX_DSL), { now: NOW });
    expect(out.kind).toBe('compiled');
    if (out.kind === 'compiled') {
      expect(out.rule.lessonHash).toMatch(/^[0-9a-f]{16}$/); // bare content hash, no -N suffix
      expect(out.rule.lessonHash).not.toBe(authored('alr-id', REGEX_DSL).ruleId);
    }
  });

  it('fails loud if an authored candidate reaches the compiler without its persisted ruleId (threading regression)', () => {
    // toCompileFeed always threads it; a hand-built authored candidate missing it would
    // silently re-derive a dslSource-keyed identity and orphan its controls — reject up front.
    const candidate: CompileInputCandidate = {
      provenance: authored('alr-missing', REGEX_DSL).provenance,
      classifierDisposition: 'structural',
      classifierLedgerRef: 'authored:alr-missing',
      dslSource: REGEX_DSL,
      declaredEngine: 'regex',
      unverified: true,
      // ruleId intentionally omitted
    };
    expect(() => compileCandidate(candidate, { now: NOW })).toThrow(/missing its persisted ruleId/);
  });

  it('fails loud if a MINED candidate carries a ruleId — the authored-only contract is enforced, not assumed', () => {
    // A mined candidate's identity stays the dslSource-derived hash; a stray ruleId
    // (well-formed or not) must NOT silently re-key it. Gated on isAuthoredProvenance,
    // not the permissive `?? hashLesson` (bot-round: gemini/greptile-P1/CR).
    const candidate: CompileInputCandidate = {
      ...candidateRule(7, REGEX_DSL),
      ruleId: '0123456789abcdef', // well-formed, yet still rejected for a mined candidate
    };
    expect(() => compileCandidate(candidate, { now: NOW })).toThrow(/must not carry a ruleId/);
  });

  it('fails loud if an authored candidate carries a malformed ruleId — id-shape precondition (greptile-P2)', () => {
    // The seam enthrones the ruleId as the firingLabelId basis, so a malformed id
    // (would orphan controls.positive[].targetRuleId) is rejected at the use site,
    // not just at the schema parse boundary.
    const candidate: CompileInputCandidate = {
      provenance: authored('alr-bad', REGEX_DSL).provenance,
      classifierDisposition: 'structural',
      classifierLedgerRef: 'authored:alr-bad',
      dslSource: REGEX_DSL,
      declaredEngine: 'regex',
      ruleId: 'not-a-valid-rule-id',
      unverified: true,
    };
    expect(() => compileCandidate(candidate, { now: NOW })).toThrow(/malformed ruleId/);
  });
});
