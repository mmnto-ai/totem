// ─── ADR-112 §8 — `totem rule author`: the authored-rule producer command ─────
//
// Thin, lazy-loaded command wrapper (the `.coderabbit.yaml` cli lazy-load rule):
// every runtime dependency loads via `await import` so none hits `totem` startup.
// The synchronous producer lives in the non-command `authored-rule-intake` lib
// (CR's suggested split). A non-decidable rule is surfaced LOUDLY — a warning + a
// non-zero exit signal — so it is NEVER a silent omission (ADR-112 §3 / the
// strategy seam-review (f)). SLICE B: from-YAML only (interactive is a later
// upgrade, §8); records are produced + ledgered, not yet fed to the certifying corpus.

export async function ruleAuthorCommand(opts: {
  judgedBy?: string;
  lcDir?: string;
}): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const { AUTHORED_RULES_REL, runRuleAuthor } = await import('../authored-rule-intake.js');
  const { resolveGitRoot, safeExec, SPLIT_REF_RE, TotemError } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const config = await loadConfig(resolveConfigPath(cwd));
  const totemDir = path.join(cwd, config.totemDir);

  // ── R1 freeze binding (ADR-112 §5.1/§8): a content-addressed splitRef in the
  //    authoring header engages the shared-history proof BEFORE intake — resolve
  //    the frozen artifact by ref, prove it on the shared ref (topology-first),
  //    and hand the VERIFIED artifact to the git-free intake. A legacy free-text
  //    splitRef binds nothing (pre-R1 shape; intake enforces the partition). ──
  let freezeBinding: { artifact: import('@mmnto/totem').FrozenSplitArtifact } | undefined;
  const yamlPath = path.join(totemDir, AUTHORED_RULES_REL);
  let declaredSplitRef: string | undefined;
  if (fs.existsSync(yamlPath)) {
    // Cheap header peek (full validation stays in runRuleAuthor): the splitRef line
    // decides whether the proof machinery loads at all (lazy-load discipline).
    const m = /^splitRef:\s*["']?(\S+?)["']?\s*$/m.exec(fs.readFileSync(yamlPath, 'utf-8'));
    declaredSplitRef = m?.[1];
  }
  const judgedBy = opts.judgedBy?.trim() || 'static-whitelist@cert-1';
  if (declaredSplitRef !== undefined && SPLIT_REF_RE.test(declaredSplitRef)) {
    // The §5.4 sandbox is NON-OPTIONAL under a content-addressed binding (#2294
    // couple): a flag whose omission skips the guard is an author-owned knob,
    // which the independence axiom forbids. Gate BEFORE the proof machinery
    // loads — nothing is verified or partially engaged on failure. The legacy
    // free-text lane below binds nothing and is byte-unaffected.
    const lcDir = opts.lcDir?.trim();
    if (lcDir === undefined || lcDir === '') {
      throw new TotemError(
        'GATE_INVALID',
        'rule author: the authoring header names a frozen split artifact (content-addressed splitRef), so the §5.4 author sandbox is NON-OPTIONAL — --lc-dir is missing.',
        'Pass --lc-dir <path-to-lc-clone> (env: TOTEM_LC_DIR); the sandbox root derives from the frozen artifact alone and its reachability proof must run before intake.',
      );
    }
    const { resolveFrozenSplitByRef, verifySharedFrozenSplit } =
      await import('../spine-freeze-proof.js');
    const repoRoot = resolveGitRoot(cwd) ?? cwd;
    const resolved = resolveFrozenSplitByRef(totemDir, repoRoot, declaredSplitRef);
    verifySharedFrozenSplit({ repoRoot, resolved, safeExec });
    freezeBinding = { artifact: resolved.artifact };
    console.log(
      `[RuleAuthor] freeze binding verified: ${resolved.artifact.splitRef} ` +
        `(commitment ${resolved.artifact.freezeCommitment.slice(0, 12)}…, shared-history proof passed)`,
    );
    // §5.4: materialize + tear down the derived sandbox to PROVE the boundary sha
    // is reachable from this clone. The root derives from the artifact alone —
    // no author-supplied root/allowlist exists on this surface (independence axiom).
    const { prepareAuthorSandbox, removeAuthorSandbox } = await import('../author-sandbox.js');
    const sandbox = prepareAuthorSandbox({
      lcDir,
      totemDir,
      artifact: resolved.artifact,
      safeExec,
    });
    console.log(
      `[RuleAuthor] §5.4 author sandbox verified: train tree as of ${sandbox.cutBoundarySha.slice(0, 12)} (derived root, torn down after intake)`,
    );
    let primaryErr: unknown;
    try {
      const result = runRuleAuthor(totemDir, { judgedBy, freezeBinding });
      reportRuleAuthor(result);
      return;
    } catch (err) {
      primaryErr = err;
      throw err;
    } finally {
      try {
        removeAuthorSandbox({ lcDir, root: sandbox.root, safeExec });
      } catch (teardownErr) {
        // A throw in `finally` SHADOWS the in-flight error (GCA #2293 round 4):
        // with no primary in flight the teardown failure IS the error (throw);
        // with one, surface the teardown loudly beside it — never replace it.
        if (primaryErr === undefined) throw teardownErr;
        console.warn(
          `[RuleAuthor] WARNING: sandbox teardown failed after a primary error (root kept at ${sandbox.root}): ${teardownErr instanceof Error ? teardownErr.message : String(teardownErr)}`,
        );
      }
    }
  }

  const result = runRuleAuthor(totemDir, { judgedBy, freezeBinding });
  reportRuleAuthor(result);
}

function reportRuleAuthor(result: import('../authored-rule-intake.js').RuleAuthorResult): void {
  console.log(
    `[RuleAuthor] ${result.records.length} authored rule(s): ` +
      `${result.minted} minted, ${result.revised} revised, ${result.unchanged} unchanged.`,
  );
  for (const rec of result.records) {
    console.log(`  + ${rec.ruleId}  ${rec.provenance.author} :: ${rec.provenance.targetDefect}`);
  }

  if (result.rejected.length > 0) {
    console.warn(
      `\n[RuleAuthor] WARNING: ${result.rejected.length} rule(s) REJECTED — not structurally ` +
        `decidable, excluded from the producer output:`,
    );
    for (const r of result.rejected) {
      console.warn(`  x ${r.author} :: ${r.targetDefect}: ${r.reason}`);
    }
    // Non-zero signal (strategy seam-review (f)) — a rejected rule is never a silent omission.
    process.exitCode = 1;
  }
}
