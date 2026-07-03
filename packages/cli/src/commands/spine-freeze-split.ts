// ─── ADR-112 §5.1/§8 R1 — `totem spine freeze-split` (the pre-authoring freeze) ─
//
// Derives the real split from lc HEAD at freeze time (Q3 derived-at-freeze:
// `asOfCommit` = the ACTUAL clone HEAD, recorded in the artifact — recent-biased
// by construction, which the live-fire falsifier wants), stamps `frozenAt` (the
// freeze IS the one legitimate clock event in the authored lane), derives the
// content-addressed `splitRef` + `freezeCommitment`, and writes the TRACKED-
// PUBLIC artifact. It does NOT commit: the freeze lands as a PR whose
// operator-named merge IS the human gate (Q3 — no separate naming ceremony);
// the artifact becomes valid-for-authoring only once the `rule author` binding
// can prove it on the shared ref (spine-freeze-proof.ts).
//
// Every gate runs BEFORE the single write — nothing lands on any failure
// (the D5 nothing-written-on-failure invariant). Thin lazy command wrapper
// (the `.coderabbit.yaml` cli lazy-load rule).

export interface FreezeSplitOptions {
  paramsPath: string;
  lcDir?: string;
  /** Explicitly authorize overwriting an existing artifact (a re-freeze is a NEW freeze via a new PR). */
  refreeze?: boolean;
  /** Working dir the repo root resolves from (default `process.cwd()`; injected for tests). */
  cwd?: string;
}

export async function freezeSplitCommand(opts: FreezeSplitOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    assembleFrozenSplitArtifact,
    canonicalStringify,
    checkHeldOutFloor,
    computeCorpusIntegrity,
    FreezeSplitParamsSchema,
    FROZEN_SPLIT_FILE,
    isBotIdentity,
    mergeCommitMap,
    parsePrNumber,
    parseRevertSha,
    resolveGitRoot,
    resolveSelectionRule,
    resolveSplit,
    safeExec,
    TotemError,
  } = await import('@mmnto/totem');
  const { enumeratePrMetas } = await import('./spine-windtunnel.js');

  const cwd = opts.cwd ?? process.cwd();
  const repoRoot = resolveGitRoot(cwd) ?? cwd;
  const totemDir = path.join(repoRoot, '.totem');

  const lcDir = opts.lcDir ?? process.env['TOTEM_LC_DIR'];
  if (!lcDir) {
    throw new TotemError(
      'CONFIG_INVALID',
      'freeze-split requires the lc clone (--lc-dir or TOTEM_LC_DIR).',
      'Pass --lc-dir <path-to-liquid-city-clone>; the freeze derives the window from its HEAD.',
    );
  }

  // 1. Load + validate the curated freeze params (the ONLY curated inputs — Q3).
  let paramsRaw: unknown;
  try {
    paramsRaw = JSON.parse(fs.readFileSync(path.resolve(cwd, opts.paramsPath), 'utf-8'));
  } catch (err) {
    throw new TotemError(
      'CONFIG_INVALID',
      `freeze-split: cannot read/parse the freeze params at ${opts.paramsPath}`,
      'Provide a valid JSON params file (see FreezeSplitParamsSchema).',
      err,
    );
  }
  const parsed = FreezeSplitParamsSchema.safeParse(paramsRaw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new TotemError(
      'CONFIG_INVALID',
      `freeze-split: params invalid:\n${issues}`,
      'Fix the params file and retry.',
    );
  }
  const params = parsed.data;

  // 2. Q3 derived-at-freeze: asOfCommit = the ACTUAL lc HEAD, derived then pinned (Tenet 20).
  let asOfCommit: string;
  try {
    asOfCommit = safeExec('git', ['-C', lcDir, 'rev-parse', 'HEAD'], {}).trim().toLowerCase();
  } catch (err) {
    throw new TotemError(
      'GIT_FAILED',
      `freeze-split: cannot resolve HEAD of the lc clone at ${lcDir}`,
      'Verify --lc-dir points at a git clone.',
      err,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(asOfCommit)) {
    throw new TotemError(
      'GIT_FAILED',
      `freeze-split: lc HEAD did not resolve to a 40-hex SHA (got "${asOfCommit}")`,
      'Verify the lc clone is intact.',
    );
  }

  // 3. Enumerate + derive the corpus from the pins.
  const metas = enumeratePrMetas(asOfCommit, lcDir, safeExec, {
    parsePrNumber,
    parseRevertSha,
    isBotIdentity,
  });
  const corpus = resolveSelectionRule(metas, {
    codePathClassifier: params.selectionRule.codePathClassifier,
    excludeRevertPairs: params.selectionRule.excludeRevertPairs,
    excludeBotPrs: params.selectionRule.excludeBotPrs,
    window: params.selectionRule.window,
  });
  if (corpus.length === 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      'freeze-split: the selection pins resolved an EMPTY corpus — nothing to freeze.',
      'Check the codePathClassifier globs against the lc history.',
    );
  }

  // 4. Resolve the split; the freeze mints `frozenAt` — the ONE legitimate clock
  //    in the authored lane (the event being stamped IS this run). All downstream
  //    verification is topology-first; the instant is a recorded fact, not a proof.
  const mergeCommitByPr = mergeCommitMap(metas);
  const split = resolveSplit({
    asOfCommit,
    corpus,
    orderedNewestFirst: metas.map((m) => m.pr),
    excludedPrs: params.split.excludedPrs,
    cutIndex: params.split.cutIndex,
    positiveControlPrs: [],
    negativeControlPrs: [],
    predicate: params.selectionRule.predicate,
    mergeCommitByPr,
    frozenAt: new Date().toISOString(),
  });

  // 5. Freeze-side Q2 floor gate (hoisted from the D5 materialize gates — the floor
  //    must hold at freeze, not first surface at materialize).
  const floorIssues = checkHeldOutFloor(split);
  if (floorIssues.length > 0) {
    throw new TotemError(
      'GATE_INVALID',
      `freeze-split rejected — ${floorIssues.length} floor violation(s):\n` +
        floorIssues.map((s) => `  • ${s}`).join('\n'),
      'Choose a cutIndex satisfying heldOut/N ≥ 0.5 (the exact ratio is the recorded build-choice, #804).',
    );
  }

  // 6. The sandbox anchor: the NEWEST train PR's merge commit (ancestry order —
  //    metas are newest-first, so the first train member encountered is newest).
  const trainSet = new Set(split.trainPrs);
  const newestTrainMeta = metas.find((m) => trainSet.has(m.pr));
  if (newestTrainMeta === undefined) {
    throw new TotemError(
      'GATE_INVALID',
      'freeze-split: no enumerated meta for any train PR — cannot derive cutBoundarySha.',
      'The enumeration must cover the corpus; verify the lc clone history.',
    );
  }

  // 7. Assemble (derives splitRef + freezeCommitment) — pure, throws on malformed.
  const artifact = assembleFrozenSplitArtifact({
    gate: params.gate,
    repo: params.repo,
    selectionPins: params.selectionRule,
    split,
    cutBoundarySha: newestTrainMeta.mergeCommit,
    corpusIntegrity: computeCorpusIntegrity(corpus, mergeCommitByPr),
    ...(params.label !== undefined ? { label: params.label } : {}),
  });

  // 8. Single write into the tracked freeze home (`.totem/spine/<gate>/frozen-split.json`;
  //    the kebab `gate` slug is schema-enforced, so the path cannot escape the home).
  //    An existing artifact is never silently overwritten: a re-freeze orphans every
  //    downstream ledger entry (t1 by design) and must be EXPLICIT.
  const gateDir = path.join(totemDir, 'spine', params.gate);
  const outFile = path.join(gateDir, FROZEN_SPLIT_FILE);
  if (fs.existsSync(outFile) && opts.refreeze !== true) {
    throw new TotemError(
      'GATE_INVALID',
      `freeze-split: a frozen split already exists at ${outFile} — overwriting IS a re-freeze (it orphans every ledger entry chained to the old commitment).`,
      'Pass --refreeze to stamp a NEW freeze deliberately (and land it via a new operator-named PR).',
    );
  }
  fs.mkdirSync(gateDir, { recursive: true });
  const text = `${canonicalStringify(artifact, 2)}\n`;
  const tmp = `${outFile}.tmp`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, outFile);

  console.error(`[FreezeSplit] frozen split written: ${outFile}`);
  console.error(`  splitRef: ${artifact.splitRef}`);
  console.error(`  freezeCommitment: ${artifact.freezeCommitment}`);
  console.error(
    `  asOfCommit (derived, lc HEAD): ${asOfCommit} · frozenAt: ${split.frozenAt ?? ''}`,
  );
  console.error(
    `  corpus: ${corpus.length} PR(s) · train ${split.trainPrs.length} ∪ held-out ${split.heldOutPrs.length} (cutIndex ${params.split.cutIndex}) · cutBoundarySha: ${artifact.cutBoundarySha}`,
  );
  console.error(
    '  next: land this artifact via the freeze PR (the operator-named merge IS the human gate); author ONLY after it reaches the shared ref.',
  );
}
