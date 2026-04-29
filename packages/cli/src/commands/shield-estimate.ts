import type { TotemConfig } from '@mmnto/totem';

import type { ShieldOptions } from './shield.js';
// totem-context: shield-templates is a pure constants + types module with no runtime logic; static import matches the established shield.ts:19 DISPLAY_TAG pattern and the lazy-import lint rule is a false positive here
import { ESTIMATE_DISPLAY_TAG } from './shield-templates.js';

/**
 * Pattern-history containment threshold (mmnto-ai/totem#1731). A pattern
 * matches the diff when at least 40% of its significant tokens (after
 * the substrate's `tokenizeForJaccard` stopword + length filter) appear
 * in the diff's added lines. Bounded [0,1]. Looser than the substrate's
 * 0.6 rule-coverage Jaccard by design — issue-driven and asymmetric.
 *
 * NOTE: this is a containment coefficient `|pattern ∩ diff| / |pattern|`
 * NOT Jaccard `|pattern ∩ diff| / |pattern ∪ diff|`. Whole-diff Jaccard
 * is mathematically broken at this scale (a 30-token pattern against a
 * 2000-token diff scores ≈ |pattern|/|diff| ≈ 0 always); containment
 * answers the right question — "what fraction of the pattern's
 * vocabulary is present in the diff."
 */
const PATTERN_HISTORY_CONTAINMENT_THRESHOLD = 0.4;

/** Max chars rendered for a pattern's sample-body excerpt in the overlay stanza. */
const PATTERN_HISTORY_SAMPLE_BODY_MAX = 120;

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
 * After `runCompiledRules` returns, the pattern-history overlay layer
 * (mmnto-ai/totem#1731) reads `.totem/recurrence-stats.json` (substrate
 * from mmnto-ai/totem#1715) and surfaces uncovered historical patterns
 * whose tokens are present in the diff additions above a containment
 * threshold. Opt out via `--no-history`. Missing/malformed substrate
 * degrades to a single dim hint line so the deterministic pass output
 * is unchanged.
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
    // Source-of-truth for staged-mode is the resolved `DiffForReviewSource`,
    // not the raw `options.staged` flag. `--diff` outranks `--staged` in
    // `getDiffForReview` (mmnto-ai/totem#1717), so passing both flags must
    // not cause `runCompiledRules` to use the staged-index read strategy
    // when the diff actually came from an explicit range
    // (mmnto-ai/totem#1732 CR R2).
    isStaged: diffResult.source === 'staged',
  });

  // Pattern-history overlay — opt out via `--no-history`
  // (mmnto-ai/totem#1731). Default-on; Commander auto-inverts the negative
  // flag, so `options.history === false` is the explicit opt-out.
  if (options.history === false) return;
  // Substrate path is rooted at `configRoot` (the dir containing
  // `totem.config.ts`), NOT `cwd` — invocations from a nested working dir
  // would otherwise probe `<cwd>/.totem/recurrence-stats.json` and disable
  // the overlay even though the substrate exists at the project root.
  // Per CR mmnto-ai/totem#1739 round-1 (Major).
  await runPatternHistoryOverlay({
    diff: diffResult.diff,
    configRoot,
    totemDir: config.totemDir,
  });
}

/**
 * Pattern-history overlay (mmnto-ai/totem#1731). Reads the recurrence
 * substrate, tokenizes the diff additions once, and prints an
 * `[Estimate] Pattern-history layer ...` stanza for every uncovered
 * pattern whose token vocabulary is present in the diff above the
 * containment threshold.
 *
 * Pure render-time projection — never persisted, never mutated. Missing
 * substrate emits one `log.dim` with remediation; malformed substrate
 * emits one `log.warn`. Both paths return cleanly so the deterministic
 * pass output is the user's verdict surface.
 */
async function runPatternHistoryOverlay(args: {
  diff: string;
  configRoot: string;
  totemDir: string;
}): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { z } = await import('zod');
  const { log } = await import('../ui.js');
  const { tokenizeForJaccard } = await import('@mmnto/totem');
  // Imported from `terminal-sanitize.js` (dep-light) NOT `../utils.js`.
  // Per CR mmnto-ai/totem#1739 R2 (Major): `cli/src/utils.ts` statically
  // imports `./orchestrators/orchestrator.js`, so loading utils on the
  // estimate path would transitively pull the orchestrator graph in
  // and break this PR's no-orchestrator-imports invariant.
  const { sanitizeForTerminal } = await import('../terminal-sanitize.js');

  // Inline 4-field projection of `RecurrenceStatsSchema` (the canonical
  // shape lives in `packages/core/src/recurrence-stats.ts`). Same
  // single-source-of-truth pattern as `retrospect.ts:124` — keep zod
  // lazy-imported and read only the fields we render so substrate
  // additions don't break the overlay. Zod is mandated at system
  // boundaries per the styleguide and the design doc Q1.
  // totem-context: Zod-at-system-boundary — substrate is filesystem-read JSON, not the "small internal data structure" the lint rule targets.
  const RecurrenceStatsFileSchema = z.object({
    // totem-context: Zod-at-system-boundary — see schema-level comment above.
    version: z.literal(1),
    // totem-context: Zod-at-system-boundary — see schema-level comment above.
    patterns: z.array(
      // totem-context: Zod-at-system-boundary — see schema-level comment above.
      z.object({
        signature: z.string(),
        occurrences: z.number(),
        // totem-context: substrate-emitted PR numbers; an empty string is substrate corruption (not user input) and would surface as a Zod-failure-on-parse downstream — converting silent overlay-skip into a hard graceful-degrade.
        prs: z.array(z.string()),
        // totem-context: substrate-emitted sample bodies; the overlay already skips empty-body patterns at match time, so `.min(1)` would convert silent skip into a hard parse failure that breaks the graceful-degrade contract.
        sampleBodies: z.array(z.string()),
      }),
    ),
  });

  const substratePath = path.join(args.configRoot, args.totemDir, 'recurrence-stats.json');
  if (!fs.existsSync(substratePath)) {
    log.dim(
      ESTIMATE_DISPLAY_TAG,
      `Pattern-history layer skipped: ${substratePath} not found — run 'totem stats --pattern-recurrence' to enable.`,
    );
    return;
  }

  type ParsedSubstrate = ReturnType<typeof RecurrenceStatsFileSchema.parse>;
  let parsed: ParsedSubstrate;
  try {
    // totem-context: synchronous read of a small JSON substrate file (typical size << 100KB) is the established pattern in the bot-tax cluster — `retrospect.ts:285` does the same. The overlay runs once after `runCompiledRules` returns; converting to fs.promises.readFile here would not change blocking behavior because the entire estimate path is awaited end-to-end.
    const raw = fs.readFileSync(substratePath, 'utf-8');
    const json: unknown = JSON.parse(raw);
    parsed = RecurrenceStatsFileSchema.parse(json);
    // totem-context: malformed/Zod-failing substrate is a graceful-degrade path per the mmnto-ai/totem#1731 failure-mode table — log + return so the deterministic-rule pass output is the user's verdict surface; rethrowing here would crash the estimator on a substrate the user never explicitly opted into.
  } catch (err) {
    // totem-context: `err` originates from JSON.parse / Zod / fs — all three surface `Error` instances in the happy unhappy-path; the `String(err)` branch is a defensive fallback for an exotic non-Error throw, not the silent `[object Object]` widening the lint rule targets.
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(ESTIMATE_DISPLAY_TAG, `Pattern-history layer skipped: ${msg}`);
    return;
  }

  // Tokenize the diff additions once. We strictly extract `^+`-prefixed
  // lines that are NOT `+++` file headers — otherwise file paths poison
  // the token pool. The substrate's `tokenizeForJaccard` then strips
  // stopwords + ≤2-char tokens so the overlay's vocabulary matches the
  // substrate's coverage check exactly.
  const diffAdditions = extractDiffAdditions(args.diff);
  const diffTokens = tokenizeForJaccard(diffAdditions);

  // Degenerate-input fast path: a punctuation-only diff or an
  // additions-stripped diff yields zero tokens. Containment is
  // structurally zero against any non-empty pattern; skip silently.
  if (diffTokens.size === 0) return;

  interface PatternHistoryMatch {
    signature: string;
    occurrences: number;
    prs: string[];
    sampleBody: string;
    containment: number;
  }

  const matches: PatternHistoryMatch[] = [];
  for (const pat of parsed.patterns) {
    if (pat.sampleBodies.length === 0) continue;
    // Substrate-by-construction emits ≥1 PR per cluster (see
    // `runRecurrenceStats`), but the projection schema doesn't enforce
    // `prs.min(1)` — keeping it open preserves the graceful-degrade
    // contract on a malformed substrate. Skip the rendering for an
    // empty PR list since the stanza ("in PRs ") would carry no signal.
    // Per CR mmnto-ai/totem#1739 R4 (Minor).
    if (pat.prs.length === 0) continue;
    // Q2 (locked): union of all up-to-3 sample bodies, not just [0]. The
    // bodies share a normalized signature so their vocabulary overlaps;
    // the union gives a more complete picture of the pattern's tokens
    // with no real downside.
    const patternTokens = tokenizeForJaccard(pat.sampleBodies.join(' '));
    if (patternTokens.size === 0) continue;
    const containment = containmentCoefficient(patternTokens, diffTokens);
    if (containment < PATTERN_HISTORY_CONTAINMENT_THRESHOLD) continue;
    matches.push({
      signature: pat.signature,
      occurrences: pat.occurrences,
      prs: pat.prs,
      sampleBody: pat.sampleBodies[0] ?? '',
      containment,
    });
  }

  // Sort by containment desc, then signature asc for determinism.
  matches.sort((a, b) => {
    if (b.containment !== a.containment) return b.containment - a.containment;
    return a.signature.localeCompare(b.signature);
  });

  if (matches.length === 0) {
    log.dim(
      ESTIMATE_DISPLAY_TAG,
      `Pattern-history layer: 0 matches above containment threshold (${PATTERN_HISTORY_CONTAINMENT_THRESHOLD}).`,
    );
    return;
  }

  // Q4 (locked): blank `[Estimate]` lines above and below the section
  // header create the visual separator AC bullet 4 calls for.
  log.info(ESTIMATE_DISPLAY_TAG, '');
  log.info(ESTIMATE_DISPLAY_TAG, '─── Pattern-history layer ───');
  log.info(
    ESTIMATE_DISPLAY_TAG,
    `${matches.length} historical pattern(s) match this diff (uncovered by current rules):`,
  );
  log.info(ESTIMATE_DISPLAY_TAG, '');

  // Sanitize every substrate-derived field before stderr — `signature`,
  // `prs`, and `sampleBody` come from `recurrence-stats.json` on disk, and
  // a tampered substrate could plant ANSI/CSI sequences that spoof cursor
  // moves or color resets. Per CR mmnto-ai/totem#1739 round-1 (Major);
  // mirrors the `sanitizeForTerminal` defense `retrospect.ts` already
  // applies to GitHub-sourced bodyExcerpt content.
  for (const m of matches) {
    const prList = m.prs.map((p) => `#${sanitizeForTerminal(p)}`).join(', ');
    log.info(
      ESTIMATE_DISPLAY_TAG,
      `  ${sanitizeForTerminal(m.signature)} — ${m.occurrences}x in PRs ${prList} (containment: ${m.containment.toFixed(2)})`,
    );
    const truncated = truncateSampleBody(
      sanitizeForTerminal(m.sampleBody),
      PATTERN_HISTORY_SAMPLE_BODY_MAX,
    );
    log.info(ESTIMATE_DISPLAY_TAG, `    "${truncated}"`);
  }
}

/**
 * Extract added lines from a unified diff into a single newline-joined
 * string. Strips the leading `+` and intentionally skips `+++` file
 * headers so file paths don't poison the token pool.
 */
function extractDiffAdditions(diff: string): string {
  const out: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('+')) continue; // totem-context: `line` is a string-typed split result, not a fileGlobs config entry — the startsWith lint rule targets the latter.
    if (line.startsWith('+++')) continue; // totem-context: same as the line above — string-typed split result.
    out.push(line.slice(1));
  }
  return out.join('\n');
}

/**
 * Containment coefficient `|A ∩ B| / |A|`. Returns 0 when `a` is empty
 * (degenerate input — no pattern vocabulary to be contained anywhere).
 * Asymmetric and bounded [0,1].
 */
function containmentCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  return intersection / a.size;
}

/**
 * Truncate a sample body for log display — collapses internal
 * whitespace (so multi-line bodies render on one line) and slices to
 * `max` chars with an ellipsis suffix.
 */
function truncateSampleBody(body: string, max: number): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max) + '…';
}
