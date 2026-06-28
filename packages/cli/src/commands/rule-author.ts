// ─── ADR-112 §8 — `totem rule author`: the authored-rule producer command ─────
//
// Thin, lazy-loaded command wrapper (the `.coderabbit.yaml` cli lazy-load rule):
// every runtime dependency loads via `await import` so none hits `totem` startup.
// The synchronous producer lives in the non-command `authored-rule-intake` lib
// (CR's suggested split). A non-decidable rule is surfaced LOUDLY — a warning + a
// non-zero exit signal — so it is NEVER a silent omission (ADR-112 §3 / the
// strategy seam-review (f)). SLICE B: from-YAML only (interactive is a later
// upgrade, §8); records are produced + ledgered, not yet fed to the certifying corpus.

export async function ruleAuthorCommand(opts: { judgedBy?: string }): Promise<void> {
  const path = await import('node:path');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const { runRuleAuthor } = await import('../authored-rule-intake.js');

  const cwd = process.cwd();
  const config = await loadConfig(resolveConfigPath(cwd));
  const totemDir = path.join(cwd, config.totemDir);

  const judgedBy = opts.judgedBy?.trim() || 'static-whitelist@cert-1';
  const result = runRuleAuthor(totemDir, { judgedBy });

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
