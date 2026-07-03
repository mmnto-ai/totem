// ─── ADR-112 §5.1/§5.4/§8 R1 — freeze-orchestration end-to-end (real git) ─────
//
// The agy seams RULING: the proof gates are exercised against PROGRAMMATIC REAL
// GIT FIXTURES (git init/commit/push in temp dirs) — injected git mocks would
// only test the mocks. Each test builds its own world (an lc clone, a totem repo
// with a bare `origin`), so tamper rows mutate freely without cross-test bleed.
// LC ENUMERATION stays real too (the freeze command shells the real
// `enumeratePrMetas`); only nothing is mocked on the proof path.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import {
  assembleFrozenSplitArtifact,
  canonicalStringify,
  CertCorpusSeedSchema,
  type FrozenSplitArtifact,
  FrozenSplitArtifactSchema,
  readAuthoringLedger,
  safeExec,
  type Stage4VerifierDeps,
} from '@mmnto/totem';

import { prepareAuthorSandbox, removeAuthorSandbox } from '../author-sandbox.js';
import { runRuleAuthor } from '../authored-rule-intake.js';
import { resolveFrozenSplitByRef, verifySharedFrozenSplit } from '../spine-freeze-proof.js';
import { materializeAuthored } from './spine-authored-materialize.js';
import {
  assembleAuthoredCertifyingCorpus,
  loadAuthoredCertRunFixtures,
} from './spine-cert-run-corpus.js';
import { freezeSplitCommand } from './spine-freeze-split.js';

const SHARED_REF = 'origin/main';
const JUDGED_BY = 'static-whitelist@cert-1';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function git(args: string[], cwd: string): string {
  return safeExec('git', args, { cwd });
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'dev@example.com'], dir);
  git(['config', 'user.name', 'Dev'], dir);
  git(['config', 'core.autocrlf', 'false'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
}

function commitAll(dir: string, message: string): string {
  git(['add', '-A'], dir);
  git(['commit', '-m', message], dir);
  return git(['rev-parse', 'HEAD'], dir).trim();
}

/** Wire a bare `origin` and push main, so `origin/main` topology is REAL. */
function wireOrigin(dir: string, bareDir: string): void {
  git(['init', '--bare', bareDir], path.dirname(bareDir));
  git(['remote', 'add', 'origin', bareDir], dir);
  pushMain(dir);
}
function pushMain(dir: string): void {
  git(['push', 'origin', 'main'], dir);
  git(['fetch', 'origin'], dir); // pin the remote-tracking ref regardless of git version
}

/** An lc fixture: an init commit (no PR) + PRs #1..#4, each adding one code file. */
function buildLc(dir: string): void {
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'lc fixture\n', 'utf-8');
  commitAll(dir, 'chore: init');
  for (const pr of [1, 2, 3, 4]) {
    fs.writeFileSync(path.join(dir, `src-f${pr}.rs`), `fn f${pr}() {}\n`, 'utf-8');
    commitAll(dir, `feat: guard ${pr} (#${pr})`);
  }
}

const FREEZE_PARAMS = {
  gate: 'gate-1',
  repo: 'fixture/lc',
  selectionRule: {
    predicate: 'code-touching non-bot',
    window: { type: 'all' as const },
    codePathClassifier: { includeGlobs: ['src-*.rs'], excludeGlobs: ['**/*.md'] },
    excludeRevertPairs: true,
    excludeBotPrs: true,
  },
  split: { cutIndex: 2, excludedPrs: [] },
};

interface World {
  lcDir: string;
  repoRoot: string;
  totemDir: string;
  artifactPath: string;
  artifact: FrozenSplitArtifact;
}

/** Freeze against the lc fixture; artifact written but NOT yet committed/shared. */
async function buildFrozenWorld(): Promise<World> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-freeze-'));
  roots.push(root);
  const lcDir = path.join(root, 'lc');
  buildLc(lcDir);
  const repoRoot = path.join(root, 'totem');
  initRepo(repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'totem fixture\n', 'utf-8');
  commitAll(repoRoot, 'chore: init');
  wireOrigin(repoRoot, path.join(root, 'origin.git'));

  const paramsPath = path.join(repoRoot, 'freeze-params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(FREEZE_PARAMS), 'utf-8');
  await freezeSplitCommand({ paramsPath, lcDir, cwd: repoRoot });

  const totemDir = path.join(repoRoot, '.totem');
  const artifactPath = path.join(totemDir, 'spine', 'gate-1', 'frozen-split.json');
  const artifact = FrozenSplitArtifactSchema.parse(
    JSON.parse(fs.readFileSync(artifactPath, 'utf-8')),
  );
  return { lcDir, repoRoot, totemDir, artifactPath, artifact };
}

/** Freeze + share (commit + push) — the operator-named freeze PR landing, condensed. */
async function buildSharedWorld(): Promise<World> {
  const w = await buildFrozenWorld();
  commitAll(w.repoRoot, 'freeze: gate-1 frozen split');
  pushMain(w.repoRoot);
  return w;
}

/** A full-ISO authoredAt strictly after the world's freeze instant (real chronology). */
function authoredAtAfterFreeze(w: World): string {
  return new Date(Date.parse(w.artifact.split.frozenAt!) + 60_000).toISOString();
}

function writeAuthoredYaml(
  w: World,
  over: {
    splitRef?: string;
    freezeCommitment?: string | null;
    fixturePr?: number;
    dslSource?: string;
  } = {},
): void {
  // `freezeCommitment: null` ⇒ OMIT the header field (the absence row); undefined ⇒ the real one.
  const commitment =
    over.freezeCommitment === null
      ? {}
      : { freezeCommitment: over.freezeCommitment ?? w.artifact.freezeCommitment };
  const doc = {
    splitRef: over.splitRef ?? w.artifact.splitRef,
    ...commitment,
    authoredAfterSplit: true,
    heldOutNonInspectionAttestation: true,
    rules: [
      {
        author: 'alice',
        authoredAt: authoredAtAfterFreeze(w),
        targetDefect: 'forbidden console.log in prod',
        declaredEngine: 'regex',
        structuralClass: 'forbidden-literal-token',
        dslSource: over.dslSource ?? 'console\\.log',
        positiveFixtures: [
          {
            pr: over.fixturePr ?? 1,
            preimageSource: {
              kind: 'lesson',
              lessonRef: 'a1b2c3d4e5f60718',
              badExample: 'console.log("dbg")',
              goodExample: 'logger.debug("dbg")',
            },
            filePath: 'src-f1.rs',
            matchedSpan: 'L1-L2',
            contentHash: 'h'.repeat(8),
          },
        ],
      },
    ],
  };
  fs.writeFileSync(
    path.join(w.totemDir, 'spine', 'authored-rules.yaml'),
    yamlStringify(doc),
    'utf-8',
  );
}

/** Resolve + prove + intake (what `totem rule author` does once the ref is content-addressed). */
function authorUnderFreeze(w: World): void {
  const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, w.artifact.splitRef);
  verifySharedFrozenSplit({ repoRoot: w.repoRoot, resolved, safeExec, sharedRef: SHARED_REF });
  runRuleAuthor(w.totemDir, {
    judgedBy: JUDGED_BY,
    freezeBinding: { artifact: resolved.artifact },
  });
}

function frozenSeed(w: World) {
  return CertCorpusSeedSchema.parse({
    producerKind: 'authored',
    gate: 'gate-1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    repo: 'fixture/lc',
    phase: 'certifying',
    selectionRule: {
      state: 'merged',
      predicate: FREEZE_PARAMS.selectionRule.predicate,
      window: { type: 'all' },
      asOfCommit: w.artifact.split.asOfCommit,
      codePathClassifier: FREEZE_PARAMS.selectionRule.codePathClassifier,
      excludeRevertPairs: true,
      excludeBotPrs: true,
    },
    split: { cutIndex: 2, excludedPrs: [], frozenSplitRef: w.artifact.splitRef },
    controls: {
      positiveRef: '.totem/spine/gate-1/controls/positive',
      negativeRef: '.totem/spine/gate-1/controls/negative',
      mechanism: 'git-hash-object',
      positive: [],
      negative: [],
    },
    fpDefinition: { rubricRef: 'r', groundTruthRef: 'g', adjudicator: 'disposition-derived' },
    cullRateThreshold: 0.1,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 0 },
    },
  });
}

async function materialize(w: World): Promise<void> {
  await materializeAuthored({
    seed: frozenSeed(w),
    lcDir: w.lcDir,
    repoRoot: w.repoRoot,
    cwd: w.repoRoot,
    totemDir: w.totemDir,
    resolveWithinRepo: (input: string) => path.resolve(w.repoRoot, input),
    safeExec,
    sharedRef: SHARED_REF,
  });
}

describe('R1 freeze-orchestration (real-git end-to-end)', () => {
  it('happy path: freeze → share → author under binding → materialize from the frozen artifact', async () => {
    const w = await buildSharedWorld();

    // The freeze derived asOfCommit from lc HEAD and pinned it (Q3 derived-at-freeze).
    expect(w.artifact.split.asOfCommit).toBe(git(['rev-parse', 'HEAD'], w.lcDir).trim());
    // Train = the 2 OLDEST PRs; the sandbox anchor is the newest TRAIN commit.
    expect(w.artifact.split.trainPrs).toEqual([1, 2]);
    expect(w.artifact.split.heldOutPrs).toEqual([3, 4]);

    writeAuthoredYaml(w);
    authorUnderFreeze(w);
    const entries = readAuthoringLedger(w.totemDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.freezeCommitment).toBe(w.artifact.freezeCommitment);
    expect(entries[0]!.splitRef).toBe(w.artifact.splitRef);
    commitAll(w.repoRoot, 'author: rule under gate-1 freeze');
    pushMain(w.repoRoot);

    await materialize(w);

    const gate1 = path.join(w.totemDir, 'spine', 'gate-1');
    const lock = JSON.parse(fs.readFileSync(path.join(gate1, 'windtunnel.lock.json'), 'utf-8'));
    expect(lock.producerKind).toBe('authored');
    expect(lock.authored).toEqual({ expectedSplitRef: w.artifact.splitRef });
    // codex fold-5: split.json is the BYTE-IDENTICAL copy of the frozen artifact's split.
    expect(fs.readFileSync(path.join(gate1, 'split.json'), 'utf-8')).toBe(
      `${canonicalStringify(w.artifact.split, 2)}\n`,
    );
  });

  it('cert re-derive threads a PROVEN freeze binding for a content-addressed run (CR round 1)', async () => {
    // The seam CR caught: the cert-run boundary re-invokes intake on authored-rules.yaml,
    // so a content-addressed run must resolve + PROVE the binding there or the intake's
    // total partition voids the verifyOnly re-derive with GATE_INVALID.
    const w = await buildSharedWorld();
    // A COMPILE-USABLE dsl (the D5 assembler fixture shape) — this row runs the full
    // assembly, so the rule must survive runCompileStage, not just intake.
    const compilableDsl = [
      '**Pattern:** `console\\.log\\(`',
      '**Engine:** regex',
      '**Severity:** warning',
      '',
      '### Bad Example',
      '```ts',
      'console.log("dbg")',
      '```',
    ].join('\n');
    writeAuthoredYaml(w, { dslSource: compilableDsl });
    authorUnderFreeze(w);
    commitAll(w.repoRoot, 'author: rule under gate-1 freeze');
    pushMain(w.repoRoot);
    await materialize(w);

    const gate1Dir = path.join(w.totemDir, 'spine', 'gate-1');
    const lock = JSON.parse(
      fs.readFileSync(path.join(gate1Dir, 'windtunnel.lock.json'), 'utf-8'),
    ) as {
      authored: { expectedSplitRef: string };
      controls: { integrity: { prDiffsSha: string } };
    };
    const { split, prDiffs, groundTruth } = await loadAuthoredCertRunFixtures(gate1Dir, {
      expectedPrDiffsSha: lock.controls.integrity.prDiffsSha,
      skipGroundTruth: true,
    });

    const stage4: Stage4VerifierDeps = {
      listFiles: () => Promise.resolve(['src-f1.rs']),
      readFile: () => Promise.resolve('logger.debug("dbg")'),
    };
    // Without the proof deps a content-addressed run REFUSES (never skips the proof)…
    await expect(
      assembleAuthoredCertifyingCorpus(
        { gate1Dir, totemDir: w.totemDir, stage4, now: authoredAtAfterFreeze(w) },
        lock as never,
      ),
    ).rejects.toThrow(/never skips resolve\+prove|repoRoot/);
    // …and WITH them the binding resolves, proves, and threads: the verifyOnly
    // re-derive passes the intake's content-ref gate and the corpus assembles.
    const { corpus } = await assembleAuthoredCertifyingCorpus(
      {
        gate1Dir,
        totemDir: w.totemDir,
        stage4,
        now: authoredAtAfterFreeze(w),
        repoRoot: w.repoRoot,
        safeExec,
      },
      lock as never,
    );
    expect(corpus.rules.length).toBeGreaterThan(0);
    // The §6 controls channel is bound — the assembly ran end-to-end, which is only
    // reachable when the proven binding satisfied the intake's content-ref gate.
    expect(corpus.authoredControls).toBeDefined();
  });

  it('refuses to overwrite an existing freeze without --refreeze', async () => {
    const w = await buildFrozenWorld();
    const paramsPath = path.join(w.repoRoot, 'freeze-params.json');
    await expect(
      freezeSplitCommand({ paramsPath, lcDir: w.lcDir, cwd: w.repoRoot }),
    ).rejects.toThrow(/re-freeze/i);
    await freezeSplitCommand({ paramsPath, lcDir: w.lcDir, cwd: w.repoRoot, refreeze: true });
  });

  it('t1: a re-freeze orphans every downstream ledger entry (commitment mismatch at materialize)', async () => {
    const w = await buildSharedWorld();
    writeAuthoredYaml(w);
    authorUnderFreeze(w);
    commitAll(w.repoRoot, 'author: rule under gate-1 freeze');
    pushMain(w.repoRoot);

    // Re-freeze (new frozenAt ⇒ new commitment; new content ⇒ new splitRef), share it.
    await freezeSplitCommand({
      paramsPath: path.join(w.repoRoot, 'freeze-params.json'),
      lcDir: w.lcDir,
      cwd: w.repoRoot,
      refreeze: true,
    });
    const refrozen = FrozenSplitArtifactSchema.parse(
      JSON.parse(fs.readFileSync(w.artifactPath, 'utf-8')),
    );
    expect(refrozen.freezeCommitment).not.toBe(w.artifact.freezeCommitment);
    commitAll(w.repoRoot, 'freeze: gate-1 RE-frozen split');
    pushMain(w.repoRoot);

    const w2: World = { ...w, artifact: refrozen };
    await expect(materialize(w2)).rejects.toThrow(/entry-commitment-mismatch|ledger-ref-mismatch/);
  });

  it('t2/t8: a frozenAt postdating the introducing commit fails the temporal-consistency row', async () => {
    const w = await buildFrozenWorld();
    // Re-assemble with a future instant (integrity stays self-consistent — only
    // the shared-history consistency check can catch a doctored stamp).
    const doctored = assembleFrozenSplitArtifact({
      gate: w.artifact.gate,
      repo: w.artifact.repo,
      selectionPins: w.artifact.selectionPins,
      split: { ...w.artifact.split, frozenAt: new Date(Date.now() + 86_400_000).toISOString() },
      cutBoundarySha: w.artifact.cutBoundarySha,
      corpusIntegrity: w.artifact.corpusIntegrity,
    });
    fs.writeFileSync(w.artifactPath, `${canonicalStringify(doctored, 2)}\n`, 'utf-8');
    commitAll(w.repoRoot, 'freeze: doctored future stamp');
    pushMain(w.repoRoot);

    const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, doctored.splitRef);
    expect(() =>
      verifySharedFrozenSplit({ repoRoot: w.repoRoot, resolved, safeExec, sharedRef: SHARED_REF }),
    ).toThrow(/temporal-consistency/);
  });

  it('t3: a ledger entry landing in the SAME commit as the freeze fails ancestry ordering', async () => {
    const w = await buildFrozenWorld();
    writeAuthoredYaml(w);
    // Bind against the not-yet-shared artifact by constructing the binding directly
    // (the shared proof would rightly refuse; the row under test is the LEDGER one).
    runRuleAuthor(w.totemDir, { judgedBy: JUDGED_BY, freezeBinding: { artifact: w.artifact } });
    commitAll(w.repoRoot, 'freeze AND author in one commit (illegitimate)');
    pushMain(w.repoRoot);
    await expect(materialize(w)).rejects.toThrow(/entry-not-after-freeze/);
  });

  it('t4: authoring against an unresolvable frozen splitRef fails loud', async () => {
    const w = await buildSharedWorld();
    const ghostRef = `split:${'e'.repeat(64)}`;
    expect(() => resolveFrozenSplitByRef(w.totemDir, w.repoRoot, ghostRef)).toThrow(
      /ref-unresolved/,
    );
    // And the git-free intake refuses a content-addressed ref with NO verified binding.
    writeAuthoredYaml(w, { splitRef: ghostRef });
    expect(() => runRuleAuthor(w.totemDir, { judgedBy: JUDGED_BY })).toThrow(
      /no verified frozen split/,
    );
  });

  it('t5: an uncommitted artifact fails the commit-anchor (distinct from not-shared)', async () => {
    const w = await buildFrozenWorld(); // written, never committed
    const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, w.artifact.splitRef);
    expect(() =>
      verifySharedFrozenSplit({ repoRoot: w.repoRoot, resolved, safeExec, sharedRef: SHARED_REF }),
    ).toThrow(/artifact-uncommitted/);
  });

  it('t5b: a committed-but-unpushed artifact fails as artifact-not-shared (the HEAD-proof gap)', async () => {
    const w = await buildFrozenWorld();
    commitAll(w.repoRoot, 'freeze: local only');
    // NOT pushed — tracked, in local HEAD ancestry, absent from origin/main.
    const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, w.artifact.splitRef);
    expect(() =>
      verifySharedFrozenSplit({ repoRoot: w.repoRoot, resolved, safeExec, sharedRef: SHARED_REF }),
    ).toThrow(/artifact-not-shared/);
  });

  it('t7a: an in-place field edit fails the pure integrity check (artifact-integrity)', async () => {
    const w = await buildSharedWorld();
    const tampered = { ...w.artifact, cutBoundarySha: 'f'.repeat(40) };
    fs.writeFileSync(w.artifactPath, `${canonicalStringify(tampered, 2)}\n`, 'utf-8');
    expect(() => resolveFrozenSplitByRef(w.totemDir, w.repoRoot, w.artifact.splitRef)).toThrow(
      /artifact-integrity/,
    );
  });

  it('t7b: a self-consistent REPLACEMENT of a shared artifact fails blob equality', async () => {
    const w = await buildSharedWorld();
    // Fully re-assembled (integrity-valid) artifact with different membership,
    // overwriting the shared file in the working tree WITHOUT a new commit.
    const replaced = assembleFrozenSplitArtifact({
      gate: w.artifact.gate,
      repo: w.artifact.repo,
      selectionPins: w.artifact.selectionPins,
      split: {
        ...w.artifact.split,
        trainPrs: [1, 2, 3],
        heldOutPrs: [4],
        splitRule: { ...w.artifact.split.splitRule, cutIndex: 3 },
      },
      cutBoundarySha: w.artifact.cutBoundarySha,
      corpusIntegrity: w.artifact.corpusIntegrity,
    });
    fs.writeFileSync(w.artifactPath, `${canonicalStringify(replaced, 2)}\n`, 'utf-8');
    const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, replaced.splitRef);
    expect(() =>
      verifySharedFrozenSplit({ repoRoot: w.repoRoot, resolved, safeExec, sharedRef: SHARED_REF }),
    ).toThrow(/artifact-uncommitted|artifact-blob-differs|artifact-not-shared/);
  });

  it('t6: the author sandbox denies reads outside the derived train-tree root', async () => {
    const w = await buildSharedWorld();
    const sandbox = prepareAuthorSandbox({
      lcDir: w.lcDir,
      totemDir: w.totemDir,
      artifact: w.artifact,
      safeExec,
    });
    try {
      // The root is workspace-derived (`<totemDir>/temp/`), never os.tmpdir().
      expect(path.relative(w.totemDir, sandbox.root).startsWith('..')).toBe(false);
      // The boundary tree is lc AT THE CUT: train PRs (#1, #2) are present…
      expect(sandbox.readFile('src-f2.rs')).toContain('fn f2');
      // …and the held-out era simply does not exist in this tree.
      expect(fs.existsSync(path.join(sandbox.root, 'src-f3.rs'))).toBe(false);
      // Escapes fail loud (t6), absolute or relative.
      expect(() => sandbox.readFile('../outside.txt')).toThrow(/§5.4|escape/);
      expect(() => sandbox.readFile(path.join(w.repoRoot, 'README.md'))).toThrow(/§5.4|escape/);
      // Symlink escape: a link INSIDE the root pointing outside must be caught by
      // the realpath containment check, not followed (greptile/CR round 1).
      const outside = path.join(w.repoRoot, 'held-out-secret.txt');
      fs.writeFileSync(outside, 'embargoed', 'utf-8');
      const linkPath = path.join(sandbox.root, 'sneaky-link.txt');
      let linkable = true;
      try {
        fs.symlinkSync(outside, linkPath);
      } catch {
        // Windows without Developer Mode cannot create symlinks — the guard is
        // still exercised on POSIX CI; skip only the symlink leg here.
        linkable = false;
      }
      if (linkable) {
        expect(() => sandbox.readFile('sneaky-link.txt')).toThrow(/§5.4|escape/);
      }
    } finally {
      removeAuthorSandbox({ lcDir: w.lcDir, root: sandbox.root, safeExec });
    }
    expect(fs.existsSync(sandbox.root)).toBe(false);
  });

  it('intake partition: header commitment absent / mismatched / on a free-text ref', async () => {
    const w = await buildSharedWorld();
    const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, w.artifact.splitRef);
    const binding = { artifact: resolved.artifact };

    writeAuthoredYaml(w, { freezeCommitment: null });
    expect(() =>
      runRuleAuthor(w.totemDir, { judgedBy: JUDGED_BY, freezeBinding: binding }),
    ).toThrow(/omits freezeCommitment/);

    writeAuthoredYaml(w, { freezeCommitment: 'c'.repeat(64) });
    expect(() =>
      runRuleAuthor(w.totemDir, { judgedBy: JUDGED_BY, freezeBinding: binding }),
    ).toThrow(/re-frozen after this header/);

    // A commitment riding a LEGACY free-text splitRef is an unanchored claim — refused.
    writeAuthoredYaml(w, { splitRef: 'split-2026-06-27' });
    expect(() => runRuleAuthor(w.totemDir, { judgedBy: JUDGED_BY })).toThrow(/free-text splitRef/);
  });

  it('intake: a positive fixture outside the frozen train slice fails at author time (§5.2 mechanical)', async () => {
    const w = await buildSharedWorld();
    const resolved = resolveFrozenSplitByRef(w.totemDir, w.repoRoot, w.artifact.splitRef);
    writeAuthoredYaml(w, { fixturePr: 3 }); // #3 is held-out
    expect(() =>
      runRuleAuthor(w.totemDir, {
        judgedBy: JUDGED_BY,
        freezeBinding: { artifact: resolved.artifact },
      }),
    ).toThrow(/NOT in the frozen train slice/);
  });

  it('#2289 must-not-widen: no R1-participating module consults the doctrine pin', () => {
    // EVERY module in the freeze-binding flow, cli AND core (CR #2293 round 1:
    // a pin reference in an unscanned participant would pass silently).
    const coreSpine = path.join(__dirname, '..', '..', '..', 'core', 'src', 'spine');
    const sources = [
      path.join(__dirname, 'spine-freeze-split.ts'),
      path.join(__dirname, '..', 'spine-freeze-proof.ts'),
      path.join(__dirname, '..', 'author-sandbox.ts'),
      path.join(__dirname, 'spine-authored-materialize.ts'),
      path.join(__dirname, '..', 'authored-rule-intake.ts'),
      path.join(__dirname, 'rule-author.ts'),
      path.join(__dirname, 'spine-authored-cert-corpus.ts'),
      path.join(__dirname, 'spine-cert-run-corpus.ts'),
      path.join(coreSpine, 'frozen-split.ts'),
      path.join(coreSpine, 'authored-rule.ts'),
      path.join(coreSpine, 'authoring-ledger.ts'),
      path.join(coreSpine, 'cert-corpus-seed.ts'),
    ];
    for (const src of sources) {
      expect(fs.existsSync(src), `scan-list path missing: ${src}`).toBe(true);
      expect(fs.readFileSync(src, 'utf-8')).not.toMatch(/strategy-doctrine/);
    }
  });
});
