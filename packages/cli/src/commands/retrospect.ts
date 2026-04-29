/**
 * `totem retrospect <pr>` — bot-tax circuit-breaker (mmnto-ai/totem#1713).
 *
 * Reads a PR's bot-review history live, groups findings into push-based
 * rounds via the per-submission `commit_id` field, enriches each finding
 * with cross-PR-recurrence flags from `.totem/recurrence-stats.json`
 * (read-only) plus rule-coverage flags from `compiled-rules.json`, and
 * emits a console report classifying findings as `route-out`,
 * `in-pr-fix`, or `undetermined` via a deterministic table-driven
 * heuristic.
 *
 * Substrate of the bot-tax cluster (#1715 + #1714 + #1713). Reuses the
 * `recurrence-stats.ts` signature + severity vocabulary so the cluster
 * has a single source of truth.
 *
 * No LLM. No GitHub API writes. Read-only outside the optional
 * `--out <path>` JSON write.
 *
 * NOTE on `--auto-file`: the auto-spec proposed shelling out to
 * `gh issue create` for every route-out candidate. The locked design
 * (see `.totem/specs/1713.md` Q2) defers `--auto-file` to a follow-up
 * ticket because mass-filing issues is irreversible and the v0.1
 * surface emits suggested titles + bodies that the human can copy-paste.
 */

import type { NormalizedBotFinding } from '../parsers/bot-review-parser.js';

// totem-context: type-only imports above are erased at compile time and don't
// violate the lazy-import command policy (mmnto-ai/totem#1729 CR R1). All
// runtime imports (node:fs, node:path, zod, @mmnto/totem, helpers, adapters)
// are dynamic — see runRetrospect body.

// ─── Constants ───────────────────────────────────────

export const RETROSPECT_DISPLAY_TAG = 'Retrospect';
const TAG = RETROSPECT_DISPLAY_TAG;
const DEFAULT_THRESHOLD = 5;
const BODY_EXCERPT_MAX = 280;

// ─── Public option surface ───────────────────────────

export interface RunRetrospectOptions {
  /** PR number to retrospect on (string for parity with `recurrence-stats`). */
  prNumber: string;
  /** Round-count threshold below which the command exits 0 with a benign skip. Default 5. */
  threshold?: number;
  /** Bypass the threshold gate — useful for ad-hoc inspection. */
  force?: boolean;
  /** Optional path to write the JSON report to (deterministic two-space indent). */
  out?: string;
}

// ─── Internal types — kept private for hygiene ───────

interface AnnotatedFinding {
  finding: NormalizedBotFinding;
  /** Push-based round number assigned via `commit_id` join. */
  roundNumber: number;
  /** ISO 8601 timestamp of the inline comment / review. */
  observedAt: string;
}

// ─── Main entrypoint ────────────────────────────────

export async function runRetrospect(options: RunRetrospectOptions): Promise<void> {
  // Dynamic imports per `packages/cli/src/commands/**` lazy-import policy
  // (mmnto-ai/totem#1729 CR R1).
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { z } = await import('zod');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
  const { log } = await import('../ui.js');
  const {
    isBotComment,
    detectBot,
    parseCRSeverity,
    parseGCASeverity,
    stripHtmlWrappers,
    extractReviewBodyFindings,
  } = await import('../parsers/bot-review-parser.js');
  const {
    buildStopConditions,
    classifyFinding,
    computeDedupRate,
    computeSignature,
    groupFindingsByRound,
    jaccard,
    loadCompiledRules,
    normalizeFindingBody,
    readLedgerEvents,
    RetrospectReportSchema,
    toSeverityBucket,
    tokenizeForJaccard,
  } = await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  // Local schema — the recurrence-stats file shape is defined in core,
  // but reading it here keeps the zod import lazy.
  const RecurrenceStatsFileSchema = z.object({
    version: z.literal(1),
    patterns: z.array(
      z.object({
        signature: z.string(),
        prs: z.array(z.string()),
      }),
    ),
    coveredPatterns: z
      .array(
        z.object({
          signature: z.string(),
          prs: z.array(z.string()),
        }),
      )
      .optional(),
  });

  const cwd = process.cwd();
  const threshold = clampThreshold(options.threshold);
  const prNumber = options.prNumber;
  const prNumberInt = Number.parseInt(prNumber, 10);
  if (!Number.isFinite(prNumberInt) || prNumberInt <= 0) {
    throw new Error(`[Totem Error] Invalid PR number: ${prNumber}`);
  }

  log.info(TAG, `Retrospect on PR #${prNumber} (threshold=${threshold}).`);

  // 1. Live-fetch PR + reviews + comments.
  const adapter = new GitHubCliPrAdapter(cwd);
  const prData = adapter.fetchPr(prNumberInt);
  const reviewSubmissions = adapter.fetchReviews(prNumberInt);
  const reviewComments = adapter.fetchReviewComments(prNumberInt);

  // 2. Round-grouping. Build a SHA → finding-count map by joining inline
  //    comments back to the closest preceding review submission via
  //    timestamp. We only consider BOT submissions because the round
  //    count is a measure of bot-driven feedback waves.
  const botSubmissions = reviewSubmissions
    .filter((r) => isBotComment(r.user_login))
    .map((r) => ({
      id: r.id,
      commit_id: r.commit_id ?? null,
      submitted_at: r.submitted_at ?? null,
      user_login: r.user_login,
    }));

  // Pre-compute the SHA bucket for each finding via timestamp join.
  // For each inline bot comment, find the latest bot review submission
  // whose `submitted_at <= comment.createdAt`, take its commit_id.
  // Comments without a parent submission (rare — orphan inline) bucket
  // into the synthetic '' SHA.
  const sortedSubs = [...botSubmissions].sort((a, b) => {
    const at = a.submitted_at ?? '';
    const bt = b.submitted_at ?? '';
    if (at < bt) return -1;
    if (at > bt) return 1;
    return 0;
  });
  function shaForInlineComment(createdAt: string | undefined): string {
    if (!createdAt) return '';
    let chosen = '';
    for (const s of sortedSubs) {
      const t = s.submitted_at ?? '';
      if (t.length === 0) continue;
      if (t <= createdAt) {
        chosen = typeof s.commit_id === 'string' ? s.commit_id : '';
      } else {
        break;
      }
    }
    return chosen;
  }

  // 3. Inline + review-body bot finding extraction.
  const inlineBotComments = reviewComments.filter((c) => isBotComment(c.author));
  const inlineFindings: Array<{
    finding: NormalizedBotFinding;
    sha: string;
    observedAt: string;
  }> = [];
  for (const c of inlineBotComments) {
    const tool = detectBot(c.author);
    const severity =
      tool === 'coderabbit'
        ? parseCRSeverity(c.body)
        : tool === 'gca'
          ? parseGCASeverity(c.body)
          : 'info';
    const body = stripHtmlWrappers(c.body);
    const hunkMatch = c.diffHunk.match(/@@ .+?\+(\d+)/);
    const line = hunkMatch ? Number.parseInt(hunkMatch[1]!, 10) : undefined;
    inlineFindings.push({
      finding: {
        tool,
        severity,
        file: c.path,
        line,
        body,
        resolutionSignal: 'none',
        rootCommentId: c.id,
      },
      sha: shaForInlineComment(c.createdAt),
      observedAt: c.createdAt ?? '',
    });
  }

  // CR review-body findings (outside-diff + nits) — bucket into the SHA
  // of the review submission that carried them.
  const reviewBodyFindings: Array<{
    finding: NormalizedBotFinding;
    sha: string;
    observedAt: string;
  }> = [];
  for (const r of reviewSubmissions) {
    if (!isBotComment(r.user_login)) continue;
    const synthesized = extractReviewBodyFindings([{ author: r.user_login, body: r.body ?? '' }]);
    const sha = typeof r.commit_id === 'string' ? r.commit_id : '';
    const observedAt = r.submitted_at ?? '';
    for (const f of synthesized) {
      reviewBodyFindings.push({ finding: f, sha, observedAt });
    }
  }

  const allFindings = [...inlineFindings, ...reviewBodyFindings];

  // SHA → finding count.
  const findingsPerSha = new Map<string, number>();
  for (const f of allFindings) {
    findingsPerSha.set(f.sha, (findingsPerSha.get(f.sha) ?? 0) + 1);
  }

  // Compute rounds via the pure helper.
  const rounds = groupFindingsByRound(sortedSubs, findingsPerSha);

  // SHA → roundNumber lookup so we can stamp each finding.
  const shaToRoundNumber = new Map<string, number>();
  for (const r of rounds) {
    shaToRoundNumber.set(r.headSha ?? '', r.roundNumber);
  }

  // 4. Substrate read — recurrence-stats (graceful degrade if missing).
  const config = await loadConfig(resolveConfigPath(cwd));
  const totemDir = path.join(cwd, config.totemDir);
  const substratePath = path.join(totemDir, 'recurrence-stats.json');
  let substrateAvailable = false;
  /** signature → list of OTHER PRs sharing this signature (target excluded). */
  const crossPrIndex = new Map<string, Set<string>>();
  if (fs.existsSync(substratePath)) {
    try {
      const raw = fs.readFileSync(substratePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const validated = RecurrenceStatsFileSchema.parse(parsed);
      substrateAvailable = true;
      const allEntries = [...(validated.patterns ?? []), ...(validated.coveredPatterns ?? [])];
      for (const entry of allEntries) {
        const others = entry.prs.filter((p) => p !== prNumber);
        const set = crossPrIndex.get(entry.signature) ?? new Set<string>();
        for (const pr of others) set.add(pr);
        crossPrIndex.set(entry.signature, set);
      }
      // totem-context: malformed substrate is a graceful-degrade path per the mmnto-ai/totem#1713 failure-mode table — log + continue with `crossPrRecurrence: 0` for every finding; `substrateAvailable: false` surfaces the degradation in the report so the consumer can see it explicitly. Hard-erroring would block the circuit-breaker the user invoked retrospect to run.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        TAG,
        `Could not parse ${substratePath}: ${msg} — running without cross-PR recurrence enrichment.`,
      );
    }
  } else {
    log.warn(
      TAG,
      `${substratePath} not found — run 'totem stats --pattern-recurrence' first to enable cross-PR enrichment.`,
    );
  }

  // 5. Compiled-rules read — graceful degrade if missing.
  // `loadCompiledRules` is intentionally `[]`-returning on ENOENT so a
  // sync-after-fresh-clone doesn't crash; we can't tell "missing" from
  // "empty manifest" by return value alone. Gate on file existence
  // first so the report's `compiledRulesAvailable` flag matches the
  // user's mental model: if the file isn't there, the coverage check
  // is structurally unavailable.
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  let compiledRulesAvailable = false;
  let ruleTokenSets: Set<string>[] = [];
  if (fs.existsSync(rulesPath)) {
    try {
      const compiledRules = loadCompiledRules(rulesPath) as Array<{ message: string }>;
      compiledRulesAvailable = true;
      ruleTokenSets = compiledRules.map((r) => tokenizeForJaccard(r.message ?? ''));
      // totem-context: malformed compiled-rules.json is a graceful-degrade path per the mmnto-ai/totem#1713 failure-mode table — log + continue with `coveredByRule: false` for every finding; `compiledRulesAvailable: false` surfaces the degradation. Mirrors the pattern in `runRecurrenceStats` step 6 ("missing/malformed compiled-rules.json disables coverage routing only").
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `Could not load compiled rules: ${msg} — coverage check disabled.`);
    }
  } else {
    log.warn(
      TAG,
      `${rulesPath} not found — run 'totem lesson compile' first to enable rule-coverage enrichment.`,
    );
  }

  // 6. Trap-ledger override events (read-only, count only).
  const ledgerEvents = readLedgerEvents(totemDir, (msg) => log.warn(TAG, msg));
  const overrideEventsObserved = ledgerEvents.filter((e) => e.type === 'override').length;

  // 7. Annotate every finding: signature, classification, recurrence, coverage.
  const annotated: AnnotatedFinding[] = allFindings.map((f) => ({
    finding: f.finding,
    roundNumber: shaToRoundNumber.get(f.sha) ?? 0,
    observedAt: f.observedAt,
  }));

  const enriched: Array<{
    signature: string;
    tool: 'coderabbit' | 'gca' | 'sarif' | 'override' | 'unknown';
    severityBucket: 'critical' | 'high' | 'medium' | 'low' | 'nit';
    bodyExcerpt: string;
    file: string;
    line?: number;
    roundNumber: number;
    crossPrRecurrence: number;
    coveredByRule: boolean;
    classification: 'route-out' | 'in-pr-fix' | 'undetermined';
    routeOutReason?: string;
  }> = [];

  for (const a of annotated) {
    const normalized = normalizeFindingBody(a.finding.body);
    if (normalized.length === 0) continue;
    const signature = computeSignature(normalized);
    const tool: 'coderabbit' | 'gca' | 'sarif' | 'override' | 'unknown' =
      a.finding.tool === 'coderabbit' ? 'coderabbit' : a.finding.tool === 'gca' ? 'gca' : 'unknown';
    const severityBucket = toSeverityBucket(tool, a.finding.severity);

    // Cross-PR recurrence — count of OTHER PRs (target excluded by construction).
    const crossPrRecurrence = crossPrIndex.get(signature)?.size ?? 0;

    // Coverage check — Jaccard 0.6 against any rule message.
    let coveredByRule = false;
    if (compiledRulesAvailable && ruleTokenSets.length > 0) {
      const findingTokens = tokenizeForJaccard(normalized);
      let maxJ = 0;
      for (const ruleTokens of ruleTokenSets) {
        const v = jaccard(findingTokens, ruleTokens);
        if (v > maxJ) maxJ = v;
      }
      coveredByRule = maxJ >= 0.6;
    }

    const verdict = classifyFinding({
      severityBucket,
      roundNumber: a.roundNumber > 0 ? a.roundNumber : 1,
      crossPrRecurrence,
      coveredByRule,
    });

    enriched.push({
      signature,
      tool,
      severityBucket,
      bodyExcerpt: a.finding.body.slice(0, BODY_EXCERPT_MAX),
      file: a.finding.file,
      line: a.finding.line,
      roundNumber: a.roundNumber > 0 ? a.roundNumber : 1,
      crossPrRecurrence,
      coveredByRule,
      classification: verdict.classification,
      routeOutReason: verdict.routeOutReason,
    });
  }

  // 8. Distribution counts.
  const byTool: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byClassification: Record<string, number> = {};
  for (const f of enriched) {
    byTool[f.tool] = (byTool[f.tool] ?? 0) + 1;
    bySeverity[f.severityBucket] = (bySeverity[f.severityBucket] ?? 0) + 1;
    byClassification[f.classification] = (byClassification[f.classification] ?? 0) + 1;
  }

  // Sort buckets — primary by roundNumber asc; tie-break: numeric PR
  // sort is on `prs[]` arrays (lesson-26935d32 applies in
  // `recurrence-stats`); here we stay deterministic via signature.
  const sortByRoundThenSig = (a: (typeof enriched)[number], b: (typeof enriched)[number]) => {
    if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
    return a.signature.localeCompare(b.signature);
  };

  const routeOutCandidates = enriched
    .filter((f) => f.classification === 'route-out')
    .sort(sortByRoundThenSig);
  const inPrFixes = enriched
    .filter((f) => f.classification === 'in-pr-fix')
    .sort(sortByRoundThenSig);
  const undetermined = enriched
    .filter((f) => f.classification === 'undetermined')
    .sort(sortByRoundThenSig);

  const dedupRate = computeDedupRate(enriched);

  // 9. Build report.
  const report = {
    version: 1 as const,
    prNumber,
    prState: prData.state,
    generatedAt: new Date().toISOString(),
    threshold,
    substrateAvailable,
    compiledRulesAvailable,
    rounds,
    totalFindings: enriched.length,
    dedupRate,
    findingDistribution: { byTool, bySeverity, byClassification },
    routeOutCandidates,
    inPrFixes,
    undetermined,
    stopConditions: [] as string[],
    overrideEventsObserved,
  };
  report.stopConditions = buildStopConditions(report);

  // Validate the assembled report shape — fail-loud on schema drift.
  RetrospectReportSchema.parse(report);

  // 10. Threshold gate.
  if (rounds.length < threshold && !options.force) {
    log.info(
      TAG,
      `PR #${prNumber} has ${rounds.length} bot-review round(s); below threshold ${threshold}. Skipping (pass --force to inspect anyway).`,
    );
    return;
  }

  // 11. Render console report.
  renderReport(report, log);

  // 12. Optional --out write (deterministic two-space JSON).
  if (options.out) {
    const outPath = path.isAbsolute(options.out) ? options.out : path.join(cwd, options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    log.info(TAG, `Wrote report → ${outPath}`);
  }
}

// ─── Console renderer ───────────────────────────────

interface MinimalLogger {
  info(tag: string, msg: string): void;
  warn(tag: string, msg: string): void;
  dim(tag: string, msg: string): void;
}

interface RenderableReport {
  prNumber: string;
  prState: string;
  rounds: ReadonlyArray<{ roundNumber: number; submittedAt: string; findingCount: number }>;
  totalFindings: number;
  substrateAvailable: boolean;
  compiledRulesAvailable: boolean;
  dedupRate: number;
  findingDistribution: {
    byTool: Record<string, number>;
    bySeverity: Record<string, number>;
    byClassification: Record<string, number>;
  };
  routeOutCandidates: ReadonlyArray<{
    signature: string;
    severityBucket: string;
    bodyExcerpt: string;
    roundNumber: number;
    routeOutReason?: string;
  }>;
  inPrFixes: ReadonlyArray<{
    signature: string;
    severityBucket: string;
    bodyExcerpt: string;
    roundNumber: number;
  }>;
  undetermined: ReadonlyArray<{
    signature: string;
    severityBucket: string;
    bodyExcerpt: string;
    roundNumber: number;
  }>;
  stopConditions: ReadonlyArray<string>;
  overrideEventsObserved: number;
}

function renderReport(report: RenderableReport, log: MinimalLogger): void {
  log.info(
    TAG,
    `PR #${report.prNumber} (${report.prState}) — ${report.rounds.length} round(s), ${report.totalFindings} bot finding(s).`,
  );
  log.dim(
    TAG,
    `  substrate=${report.substrateAvailable ? 'available' : 'absent'}, compiled-rules=${report.compiledRulesAvailable ? 'available' : 'absent'}, dedup-rate=${(report.dedupRate * 100).toFixed(0)}%`,
  );

  // Distribution
  const tools = Object.entries(report.findingDistribution.byTool)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  const severities = Object.entries(report.findingDistribution.bySeverity)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  const classifications = Object.entries(report.findingDistribution.byClassification)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  if (tools) log.dim(TAG, `  tool: ${tools}`);
  if (severities) log.dim(TAG, `  severity: ${severities}`);
  if (classifications) log.dim(TAG, `  classification: ${classifications}`);

  // Route-out candidates.
  if (report.routeOutCandidates.length > 0) {
    log.info(TAG, `Route-out candidates (${report.routeOutCandidates.length}):`);
    for (const f of report.routeOutCandidates) {
      const snippet = f.bodyExcerpt.replace(/\s+/g, ' ').slice(0, 80);
      const reason = f.routeOutReason ?? '';
      log.dim(
        TAG,
        `  [r${f.roundNumber}] ${f.severityBucket} ${f.signature} — ${snippet} (${reason})`,
      );
    }
  } else {
    log.dim(TAG, 'Route-out candidates: (none)');
  }

  // In-PR fixes.
  if (report.inPrFixes.length > 0) {
    log.info(TAG, `In-PR fixes (${report.inPrFixes.length}):`);
    for (const f of report.inPrFixes) {
      const snippet = f.bodyExcerpt.replace(/\s+/g, ' ').slice(0, 80);
      log.dim(TAG, `  [r${f.roundNumber}] ${f.severityBucket} ${f.signature} — ${snippet}`);
    }
  } else {
    log.dim(TAG, 'In-PR fixes: (none)');
  }

  // Undetermined.
  if (report.undetermined.length > 0) {
    log.info(TAG, `Undetermined (${report.undetermined.length}):`);
    for (const f of report.undetermined) {
      const snippet = f.bodyExcerpt.replace(/\s+/g, ' ').slice(0, 80);
      log.dim(TAG, `  [r${f.roundNumber}] ${f.severityBucket} ${f.signature} — ${snippet}`);
    }
  }

  // Stop conditions.
  if (report.stopConditions.length > 0) {
    log.info(TAG, 'Stop conditions:');
    for (const cond of report.stopConditions) {
      log.dim(TAG, `  • ${cond}`);
    }
  }

  if (report.overrideEventsObserved > 0) {
    log.dim(TAG, `Trap ledger: ${report.overrideEventsObserved} override event(s) observed.`);
  }
}

// ─── Helpers ────────────────────────────────────────

function clampThreshold(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input) || input < 1) return DEFAULT_THRESHOLD;
  return Math.floor(input);
}
