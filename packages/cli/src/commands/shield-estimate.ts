import type { TotemConfig } from '@mmnto/totem';

import type { ShieldOptions } from './shield.js';
// totem-context: shield-templates is a pure constants module — static
// import is correct and the dynamic-imports-in-CLI lint rule is a false
// positive here. Same pattern as shield.ts's DISPLAY_TAG import.
import { ESTIMATE_DISPLAY_TAG } from './shield-templates.js';

/**
 * Pre-flight deterministic-rule estimator for `totem review --estimate`
 * (mmnto-ai/totem#1714). Runs the same compiled-rule engine as
 * `totem lint` against the diff resolved by `totem review`'s standard
 * resolution chain (explicit `--diff` → `--staged` → working-tree →
 * branch-vs-base) and returns immediately. No orchestrator, no
 * embedder, no LanceDB — the entire LLM Verification Layer is
 * structurally unreachable from this module.
 *
 * Output is labeled `[Estimate]` (`ESTIMATE_DISPLAY_TAG`) on every log
 * line so consumers cannot conflate this with an LLM verdict; the
 * verdict line and `SHIELD_FAILED` exit semantics are inherited from
 * `runCompiledRules` unchanged so a passing estimate looks identical to
 * a passing `totem lint` run on the metrics + trap-ledger surface.
 *
 * Empty-diff handling intentionally does NOT stamp the
 * `.reviewed-content-hash` push-gate cache: an estimate is a forecast,
 * not a passing review, and stamping the cache would let the push-gate
 * unblock without ever running the LLM review.
 */
export async function runEstimate(
  options: ShieldOptions,
  config: TotemConfig,
  cwd: string,
  configRoot: string,
): Promise<void> {
  const { log } = await import('../ui.js');
  const { getDiffForReview } = await import('../git.js');
  const { runCompiledRules } = await import('./run-compiled-rules.js');

  log.info(ESTIMATE_DISPLAY_TAG, 'Pre-flight prediction (deterministic, zero-LLM):');

  const diffResult = await getDiffForReview(options, config, cwd, ESTIMATE_DISPLAY_TAG);
  if (!diffResult) {
    // Distinct from the `totem review` no-diff branch: the LLM path
    // stamps the push-gate content hash because an empty diff is a
    // trivial pass; an estimate is a forecast and explicitly does NOT
    // stamp the cache. (Q2 in `.totem/specs/1714.md`.)
    log.info(ESTIMATE_DISPLAY_TAG, 'No changes detected. Nothing to estimate.');
    return;
  }

  await runCompiledRules({
    diff: diffResult.diff,
    cwd,
    totemDir: config.totemDir,
    format: 'text',
    outPath: options.out,
    ignorePatterns: config.ignorePatterns,
    tag: ESTIMATE_DISPLAY_TAG,
    configRoot,
    isStaged: !!options.staged,
  });
}
