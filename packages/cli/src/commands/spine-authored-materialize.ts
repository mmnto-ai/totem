// ─── ADR-112 §5.1/§6/§8 Slice D5 — the AUTHORED cert-corpus materializer ─────
//
// The SIBLING of the mined `materializeCommand` (spine-cert-materialize.ts), NOT a
// branch inside it: the authored producer freezes a WINDOW-WIDE scoring substrate
// (train ∪ held-out) with train-side controls + a mechanical `frozenAt`, whereas
// the mined producer freezes a held-out-only substrate with held-out control tags.
// A single kind-branch would be one function doing two disjoint jobs (Tenet-9). The
// materialize command ENTRY resolves `seed.producerKind` ONCE and dispatches here.
//
// Freeze-vs-run division (D1/D2.5): this FREEZES the substrate (split.json with
// `frozenAt`, the window-wide pr-diffs.json, the train-side control dirs, the lock
// with `producerKind:'authored'` + `authored:{expectedSplitRef}`). The RUN side
// (`buildAuthoredCertifyingCorpus`) COMPILES the rules + derives the §6 controls;
// `derive-labels` stamps `groundTruthSha`. So materialize does NEITHER — it reads
// the effective authoring-ledger for the split-binding + the train-side control
// fixture PRs, runs the §5.1/§5.3 freeze gates, and pins the substrate.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CertCorpusSeed, PrMeta, ResolvedPrInput } from '@mmnto/totem';

// The two sibling CLI command modules are lazy-loaded INSIDE `materializeAuthored` (this file is
// itself dynamic-imported by `materializeCommand`), per the `packages/cli/**` lazy-load convention
// (CR Major, matching the D4 precedent). `node:*` builtins stay static (lightweight, codebase norm).

type SafeExecFn = typeof import('@mmnto/totem').safeExec;

/** A single git resolution for one PR (base/head/diff), as `resolvePrGit` returns. */
interface PrGitResolution {
  baseSha: string;
  headSha: string;
  diff: string;
}

/**
 * The runtime context the dispatch hands the authored sibling (already-resolved
 * repo/lc/seed + the sandbox-guarded path resolver + the git runner). Mirrors what
 * the mined `materializeCommand` computes before its producer work.
 */
export interface AuthoredMaterializeContext {
  seed: CertCorpusSeed;
  lcDir: string;
  repoRoot: string;
  cwd: string;
  /** `.totem` dir holding `spine/authoring-ledger.ndjson` (default: `<repoRoot>/.totem`). */
  totemDir: string;
  outDir?: string;
  resolveWithinRepo: (input: string, field: string) => string;
  safeExec: SafeExecFn;
}

/**
 * Injectable I/O seams — real git by default; tests inject fakes so the producer is
 * exercisable WITHOUT a real lc clone (the mined materializer is not, so it has no
 * unit test). There is deliberately NO `now` seam: `frozenAt` is the seed's recorded
 * pre-authoring freeze instant (never a materialize clock — #2287 couple HOLD), so the
 * producer is fully deterministic from its inputs.
 */
export interface AuthoredMaterializeDeps {
  enumerateMetas: (asOfCommit: string) => PrMeta[];
  resolvePrDiff: (mergeCommit: string) => PrGitResolution;
  computeControlFixtureSha: (controlDirs: string[]) => string | null;
}

function uniqueSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/**
 * Materialize the AUTHORED cert-run scoring corpus. Fail-loud (Tenet-4) throughout:
 * an empty corpus, an empty/mixed-split-ref ledger, or any §5.1/§5.3 freeze-gate
 * violation THROWS before a byte is written (detect-never-repair — the materializer
 * never re-freezes a leaked split). Writes the lock WITHOUT `groundTruthSha`
 * (`derive-labels` stamps it) and WITHOUT `llmReplaySha` (no LLM stage on the
 * authored path); the two-phase seal is `derive-labels` → `freeze`.
 */
export async function materializeAuthored(
  ctx: AuthoredMaterializeContext,
  depsOverride: Partial<AuthoredMaterializeDeps> = {},
): Promise<void> {
  const {
    resolveSelectionRule,
    resolveSplit,
    mergeCommitMap,
    buildWindtunnelLock,
    canonicalStringify,
    readAuthoringLedger,
    foldEffectiveLedgerEntries,
    assertAuthoredFreezePreconditions,
    TotemError,
    parsePrNumber,
    parseRevertSha,
    isBotIdentity,
  } = await import('@mmnto/totem');
  // Lazy-load the sibling CLI command modules (packages/cli/** convention — CR Major).
  const { resolvePrGit } = await import('./spine-cert-materialize.js');
  const { computeFixtureSha, enumeratePrMetas } = await import('./spine-windtunnel.js');

  const { seed, lcDir, repoRoot, cwd, totemDir, resolveWithinRepo, safeExec } = ctx;

  const deps: AuthoredMaterializeDeps = {
    enumerateMetas:
      depsOverride.enumerateMetas ??
      ((asOf) =>
        enumeratePrMetas(asOf, lcDir, safeExec, { parsePrNumber, parseRevertSha, isBotIdentity })),
    resolvePrDiff: depsOverride.resolvePrDiff ?? ((mc) => resolvePrGit(lcDir, mc, safeExec)),
    computeControlFixtureSha:
      depsOverride.computeControlFixtureSha ??
      ((dirs) => computeFixtureSha(dirs, repoRoot, safeExec)),
  };

  // 1. Enumerate + resolve the corpus (pure).
  const metas = deps.enumerateMetas(seed.selectionRule.asOfCommit);
  const corpus = resolveSelectionRule(metas, {
    codePathClassifier: seed.selectionRule.codePathClassifier,
    excludeRevertPairs: seed.selectionRule.excludeRevertPairs,
    excludeBotPrs: seed.selectionRule.excludeBotPrs,
    window: seed.selectionRule.window,
  });
  if (corpus.length === 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      'authored materialize: selectionRule resolved an EMPTY corpus — no qualifying code-touching PRs.',
      'Check the seed codePathClassifier globs + the enumerated history.',
    );
  }

  // 2. Bind the split's `frozenAt` to the REAL pre-authoring freeze instant recorded in the
  //    seed (§5.1 "frozen before authoring"), then resolve + freeze. NEVER a materialize-`now()`
  //    stamp: materialize necessarily runs AFTER authoring (it requires a non-empty ledger below),
  //    so a `now()` frozenAt is after every `authoredAt` ⇒ the Q3 temporal gate would ALWAYS throw
  //    (#2287 couple HOLD). Fail loud if the seed carries no freeze instant — the split must be
  //    frozen (and its instant recorded) before authoring; materialize must not invent one. The
  //    full pre-authoring freeze orchestration (a mechanical freeze-split step + `rule author`
  //    binding) is the real-set follow-on; D5 loads the operator-recorded instant.
  const frozenAt = seed.split.frozenAt;
  if (frozenAt === undefined) {
    throw new TotemError(
      'GATE_INVALID',
      'authored materialize: seed.split.frozenAt is absent — the split must be frozen BEFORE ' +
        'authoring (ADR-112 §5.1) and its freeze instant recorded; materialize must not stamp its ' +
        'own clock (a materialize-now freeze is necessarily after authoring ⇒ the Q3 temporal gate ' +
        'would always fail).',
      'Freeze the split before authoring and record its freeze instant as seed.split.frozenAt (full ISO-8601).',
    );
  }
  // Authored controls are train-side (derived at RUN from the rules), so the split carries NO
  // held-out control tags — positive/negative control PRs are [] (the mined notion is inapplicable).
  const split = resolveSplit({
    asOfCommit: seed.selectionRule.asOfCommit,
    corpus,
    orderedNewestFirst: metas.map((m) => m.pr),
    excludedPrs: seed.split.excludedPrs,
    cutIndex: seed.split.cutIndex,
    positiveControlPrs: [],
    negativeControlPrs: [],
    predicate: seed.selectionRule.predicate,
    mergeCommitByPr: mergeCommitMap(metas),
    frozenAt,
  });

  // 3. Effective authoring-ledger → the single split-binding + the train-side control PRs.
  const ledger = readAuthoringLedger(totemDir);
  if (ledger.length === 0) {
    throw new TotemError(
      'GATE_INVALID',
      'authored materialize: the authoring-ledger is empty — there are no authored rules to freeze.',
      'Run `totem rule author` to author + record rules before materializing the cert corpus.',
    );
  }
  const effective = foldEffectiveLedgerEntries(ledger);
  const splitRefs = new Set(effective.map((e) => e.splitRef));
  if (splitRefs.size !== 1) {
    throw new TotemError(
      'GATE_INVALID',
      `authored materialize: the authoring-ledger records ${splitRefs.size} distinct splitRef values ` +
        `([${[...splitRefs].join(', ')}]) — a single cert corpus binds ONE frozen split.`,
      'Author the whole set under one frozen split; multi-split corpora are out of scope (ADR-112 §5).',
    );
  }
  const expectedSplitRef = [...splitRefs][0]!;

  // 4. §5.1/§5.3 freeze gates (Q2 held-out floor + Q3 temporal + Q3 membership) — fail-loud,
  //    compose-never-replace, BEFORE any write (detect-never-repair, sensor-not-actuator).
  assertAuthoredFreezePreconditions(split, effective);

  // Non-vacuity gate BEFORE any write AND any per-PR git work (greptile P2; hoisted above the
  // step-5 resolution loop per CR round-2): if no rule declares a train-side positive fixture,
  // the §5 integrity gate (fixtureSha) has nothing to hash — fail loud HERE, knowable from the
  // effective ledger alone, so a vacuous ledger costs zero `resolvePrDiff` shell-outs and keeps
  // the "no bytes written on gate failure" invariant the Q2/Q3 freeze gates uphold.
  const posFixturePrs = uniqueSorted(effective.flatMap((e) => e.positiveFixturePrs));
  if (posFixturePrs.length === 0) {
    throw new TotemError(
      'GATE_INVALID',
      'authored materialize: no positive-control fixture PRs in the effective authoring-ledger — the ' +
        '§5 integrity gate (fixtureSha) has nothing to hash.',
      'Author at least one rule with a train-side positiveFixture (non-vacuity, ADR-112 §6).',
    );
  }

  // 5. Resolve git base/head/diff for EVERY corpus PR (fail-loud, non-empty per resolvePrGit).
  const mergeByPr = new Map(metas.map((m) => [m.pr, m.mergeCommit]));
  const gitByPr = new Map<number, PrGitResolution>();
  for (const pr of corpus) {
    const mc = mergeByPr.get(pr);
    if (mc === undefined) {
      throw new TotemError(
        'CONFIG_INVALID',
        `authored materialize: corpus PR #${pr} has no enumerated merge commit.`,
        'Verify the lc clone is complete at asOfCommit.',
      );
    }
    gitByPr.set(pr, deps.resolvePrDiff(mc));
  }

  const resolvedPrs: ResolvedPrInput[] = corpus.map((pr) => {
    const g = gitByPr.get(pr)!;
    return { pr, mergeCommit: mergeByPr.get(pr)!, baseSha: g.baseSha, headSha: g.headSha };
  });

  // Fixture-membership guard BEFORE any write (CR round-2, outside-diff): unreachable by
  // construction TODAY (Q3 membership asserts fixtures ⊆ train, and resolveSplit derives
  // train ⊆ corpus = gitByPr's keys), but if a future regression ever broke that chain, the
  // throw must leave ZERO bytes — the same "no bytes on gate failure" invariant every other
  // gate in this function upholds. Defense-in-depth stays consistent with the invariant.
  for (const pr of posFixturePrs) {
    if (!gitByPr.has(pr)) {
      throw new TotemError(
        'GATE_INVALID',
        `authored materialize: positive-control fixture PR #${pr} is not in the resolved corpus.`,
        'Every positive fixture must be a train-slice corpus member (ADR-112 §5).',
      );
    }
  }

  // 6. WINDOW-WIDE substrate (codex #1/#2): pr-diffs.json over `train ∪ heldOut` (NOT the mined
  //    held-out-only shape), so train-side controls + window-wide FP scoring (§5.3/§9) have their
  //    firing substrate. Control ROLES are the run-derived §6 channel, so every window PR is a
  //    plain `corpus` diff here (build-altitude call — see the spec couple flags).
  const windowPrs = uniqueSorted([...split.trainPrs, ...split.heldOutPrs]);
  const prDiffs = windowPrs.map((pr) => ({
    pr,
    diff: gitByPr.get(pr)!.diff,
    controlKind: 'corpus' as const,
  }));

  // 7. Write split.json + pr-diffs.json (canonical, sorted-key, LF + trailing newline; atomic).
  const gate1Dir = ctx.outDir
    ? path.resolve(cwd, ctx.outDir)
    : resolveWithinRepo(path.dirname(seed.canonicalPath), 'seed.canonicalPath directory');
  fs.mkdirSync(gate1Dir, { recursive: true });
  const writeCanonical = (file: string, value: unknown): string => {
    const text = `${canonicalStringify(value, 2)}\n`;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, file);
    return text;
  };
  writeCanonical(path.join(gate1Dir, 'split.json'), split);
  const prDiffsText = writeCanonical(path.join(gate1Dir, 'pr-diffs.json'), prDiffs);
  const prDiffsSha = createHash('sha256')
    .update(prDiffsText.replace(/\r\n/g, '\n'), 'utf-8')
    .digest('hex');

  // 8. Control dirs — the train-side positive-control fixture PRs (from the ledger; the freeze gate
  //    already asserted they are ⊆ train). Negatives are synthetic near-misses (no corpus PR), so
  //    the negative dir is empty. The `<pr>.diff` is the SAME resolved diff (single-source).
  const posDir = resolveWithinRepo(seed.controls.positiveRef, 'seed.controls.positiveRef');
  const negDir = resolveWithinRepo(seed.controls.negativeRef, 'seed.controls.negativeRef');
  for (const dir of [posDir, negDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  // `posFixturePrs` was non-vacuity-checked AND membership-checked against `gitByPr` before any
  // write, so every fixture PR resolves here (the `!` is upheld by the pre-write guard above).
  for (const pr of posFixturePrs) {
    fs.writeFileSync(path.join(posDir, `${pr}.diff`), gitByPr.get(pr)!.diff, 'utf-8');
  }
  // POST-write integrity SENSOR (not a precondition gate): it hashes the control dirs it just
  // wrote, so it cannot precede its own write (CR round-2 asked; declined for this half). With
  // non-vacuity + membership both pre-write, a null here means `computeControlFixtureSha` itself
  // misbehaved — fail loud; a re-run is safe (control dirs are rm+recreated, writes atomic).
  const fixtureSha = deps.computeControlFixtureSha([posDir, negDir]);
  if (!fixtureSha) {
    throw new TotemError(
      'GATE_INVALID',
      'authored materialize: no positive-control fixture diffs were written — the §5 integrity gate ' +
        '(fixtureSha) has nothing to hash.',
      'Author at least one rule with a train-side positiveFixture (non-vacuity, ADR-112 §6).',
    );
  }

  // 9. Assemble + write the lock (producerKind:'authored' + authored.expectedSplitRef; no
  //    groundTruthSha — derive-labels stamps it; no llmReplaySha — no authored LLM stage).
  const lock = buildWindtunnelLock({
    seed,
    resolvedPrs,
    integrity: { fixtureSha, prDiffsSha },
    producerKind: 'authored',
    authored: { expectedSplitRef },
  });
  writeCanonical(path.join(gate1Dir, path.basename(seed.canonicalPath)), lock);

  console.error(`[AuthoredCertMaterialize] gate1Dir: ${gate1Dir}`);
  console.error(
    `  producerKind: authored · expectedSplitRef: ${expectedSplitRef} · frozenAt: ${frozenAt}`,
  );
  console.error(
    `  corpus: ${corpus.length} PR(s) · window (scored): ${windowPrs.length} (train ${split.trainPrs.length} ∪ held-out ${split.heldOutPrs.length})`,
  );
  console.error(`  positive-control fixtures: ${posFixturePrs.length} · fixtureSha: ${fixtureSha}`);
  console.error(`  prDiffsSha: ${prDiffsSha}`);
  console.error(
    `  groundTruthSha: (pending — run \`spine windtunnel derive-labels\` then \`freeze\` to seal)`,
  );
}
