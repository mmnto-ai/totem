/**
 * `totem stats --pattern-recurrence` — cross-PR recurrence clustering.
 *
 * Substrate of mmnto-ai/totem#1715. Fetches bot-review findings across
 * the most recent N merged PRs (configurable via --history-depth, default
 * 50, capped at 200), folds in trap-ledger override events as co-equal
 * findings, clusters by normalized signature, filters out clusters
 * already covered by an existing compiled rule, and writes the survivors
 * at `.totem/recurrence-stats.json` plus a stdout summary.
 *
 * No LLM. No GitHub API writes. Stateless per invocation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type { NormalizedBotFinding } from '../parsers/bot-review-parser.js';

// ─── Constants ───────────────────────────────────────

const TAG = 'Recurrence';
const DEFAULT_THRESHOLD = 5;
const DEFAULT_HISTORY_DEPTH = 50;
const MAX_HISTORY_DEPTH = 200;
const MAX_SAMPLE_BODIES = 3;
const MAX_PATHS = 10;
const COVERAGE_JACCARD_THRESHOLD = 0.6;

// ─── Types ───────────────────────────────────────────

export interface RunRecurrenceStatsOptions {
  threshold?: number;
  historyDepth?: number;
  yes?: boolean;
}

/** Internal: a finding plus its source PR + observed timestamp. */
interface AnnotatedFinding {
  finding: NormalizedBotFinding;
  prNumber: string | undefined;
  observedAt: string;
}

// ─── gh PR list schema ──────────────────────────────

const GhMergedPrListItemSchema = z.object({
  number: z.number(),
  mergedAt: z.string().nullable().optional(),
});

// ─── Severity bucket mapping ────────────────────────

type SeverityBucket = 'critical' | 'high' | 'medium' | 'low' | 'nit';

function toSeverityBucket(
  tool: NormalizedBotFinding['tool'] | 'override',
  severity: string,
): SeverityBucket {
  const s = severity.toLowerCase();
  if (tool === 'override') return 'medium';
  if (tool === 'coderabbit') {
    if (s === 'critical') return 'critical';
    if (s === 'major') return 'high';
    if (s === 'minor') return 'medium';
    return 'low';
  }
  if (tool === 'gca') {
    if (s === 'high') return 'high';
    if (s === 'medium') return 'medium';
    if (s === 'low') return 'low';
    return 'low';
  }
  // unknown tool / synthesized review-body
  if (s === 'critical') return 'critical';
  if (s === 'high' || s === 'major') return 'high';
  if (s === 'medium' || s === 'minor' || s === 'warning') return 'medium';
  if (s === 'low' || s === 'info') return 'low';
  return 'nit';
}

// ─── Main entrypoint ────────────────────────────────

export async function runRecurrenceStats(options: RunRecurrenceStatsOptions = {}): Promise<void> {
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
  const { handleGhError, ghFetchAndParse } = await import('../adapters/gh-utils.js');
  const { log } = await import('../ui.js');
  const {
    isBotComment,
    detectBot,
    parseCRSeverity,
    parseGCASeverity,
    stripHtmlWrappers,
    extractSuggestion,
    extractReviewBodyFindings,
  } = await import('../parsers/bot-review-parser.js');
  const {
    computeSignature,
    jaccard,
    loadCompiledRules,
    normalizeFindingBody,
    readLedgerEvents,
    tokenizeForJaccard,
  } = await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();

  // 1. Validate + clamp options
  const threshold = clampThreshold(options.threshold);
  let historyDepth = clampHistoryDepth(options.historyDepth);
  if (options.historyDepth !== undefined && options.historyDepth > MAX_HISTORY_DEPTH) {
    log.warn(
      TAG,
      `--history-depth ${options.historyDepth} exceeds cap of ${MAX_HISTORY_DEPTH}; using ${MAX_HISTORY_DEPTH} instead.`,
    );
    historyDepth = MAX_HISTORY_DEPTH;
  }

  log.info(TAG, `Scanning up to ${historyDepth} merged PR(s); threshold=${threshold}.`);

  // 2. Fetch the most recent merged PRs via gh
  let prList: Array<{ number: number; mergedAt?: string | null }> = [];
  try {
    prList = ghFetchAndParse(
      [
        'pr',
        'list',
        '--state',
        'merged',
        '--limit',
        String(historyDepth),
        '--json',
        'number,mergedAt',
      ],
      z.array(GhMergedPrListItemSchema),
      'merged PR list',
      cwd,
    );
  } catch (err) {
    // ghFetchAndParse already wraps via handleGhError on its own throw path,
    // but if anything slipped through wrap it here for the same hint surface.
    handleGhError(err, 'merged PR list');
  }

  log.info(TAG, `Found ${prList.length} merged PR(s).`);

  // 3. Per-PR fetch + finding extraction
  const adapter = new GitHubCliPrAdapter(cwd);
  const annotated: AnnotatedFinding[] = [];
  const prsScanned: string[] = [];

  for (const pr of prList) {
    const prNum = pr.number;
    try {
      const prData = adapter.fetchPr(prNum);
      const reviewComments = adapter.fetchReviewComments(prNum);

      // Group threads by root id
      const threads = groupThreadsByRoot(reviewComments);
      const botThreads = threads.filter(
        (t) => t.comments.length > 0 && isBotComment(t.comments[0]!.author),
      );

      // Inline bot findings
      const inlineFindings: NormalizedBotFinding[] = [];
      for (const thread of botThreads) {
        const botComment = thread.comments[0];
        if (!botComment) continue;
        const tool = detectBot(botComment.author);
        const severity =
          tool === 'coderabbit'
            ? parseCRSeverity(botComment.body)
            : tool === 'gca'
              ? parseGCASeverity(botComment.body)
              : 'info';

        const body = stripHtmlWrappers(botComment.body);
        const suggestion = extractSuggestion(botComment.body);
        const hunkMatch = thread.diffHunk.match(/@@ .+?\+(\d+)/);
        const line = hunkMatch ? parseInt(hunkMatch[1]!, 10) : undefined;

        inlineFindings.push({
          tool,
          severity,
          file: thread.path,
          line,
          body,
          suggestion,
          resolutionSignal: 'none',
          rootCommentId: botComment.id,
        });
      }

      // Review-body findings (CR outside-diff + nits)
      const reviewBodyFindings = extractReviewBodyFindings(prData.reviews);

      const allFindings = [...inlineFindings, ...reviewBodyFindings];
      // Use the PR's mergedAt as observation timestamp (best available).
      const observedAt = pr.mergedAt ?? new Date().toISOString();
      for (const f of allFindings) {
        annotated.push({
          finding: f,
          prNumber: String(prNum),
          observedAt,
        });
      }

      prsScanned.push(String(prNum));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `PR #${prNum}: skipped (${msg})`);
      continue;
    }
  }

  log.info(
    TAG,
    `Scanned ${prsScanned.length}/${prList.length} PR(s); collected ${annotated.length} bot finding(s).`,
  );

  // 4. Trap-ledger overrides as co-equal findings (Q4)
  const config = await loadConfig(resolveConfigPath(cwd));
  const totemDir = path.join(cwd, config.totemDir);
  const ledgerEvents = readLedgerEvents(totemDir, (msg) => log.warn(TAG, msg));
  const overrideEvents = ledgerEvents.filter((e) => e.type === 'override');
  for (const event of overrideEvents) {
    const synthetic: NormalizedBotFinding = {
      tool: 'unknown',
      severity: 'medium',
      file: event.file,
      line: event.line,
      body: event.justification,
      resolutionSignal: 'none',
    };
    annotated.push({
      finding: synthetic,
      prNumber: undefined,
      observedAt: event.timestamp,
    });
  }
  if (overrideEvents.length > 0) {
    log.info(TAG, `Folded in ${overrideEvents.length} trap-ledger override event(s).`);
  }

  // 5. Cluster by signature
  interface MutableCluster {
    signature: string;
    tools: Set<'coderabbit' | 'gca' | 'sarif' | 'override' | 'unknown'>;
    severityBuckets: SeverityBucket[];
    occurrences: number;
    prs: Set<string>;
    sampleBodies: string[];
    firstSeen: string;
    lastSeen: string;
    paths: Set<string>;
    normalizedBody: string;
  }

  const clusters = new Map<string, MutableCluster>();

  for (const a of annotated) {
    const isOverride = a.prNumber === undefined;
    const tool = isOverride ? ('override' as const) : a.finding.tool;

    const normalized = normalizeFindingBody(a.finding.body);
    if (normalized.length === 0) continue;
    const signature = computeSignature(normalized);

    const bucket = toSeverityBucket(tool, a.finding.severity);

    let cluster = clusters.get(signature);
    if (!cluster) {
      cluster = {
        signature,
        tools: new Set(),
        severityBuckets: [],
        occurrences: 0,
        prs: new Set(),
        sampleBodies: [],
        firstSeen: a.observedAt,
        lastSeen: a.observedAt,
        paths: new Set(),
        normalizedBody: normalized,
      };
      clusters.set(signature, cluster);
    }

    cluster.tools.add(tool);
    cluster.severityBuckets.push(bucket);
    cluster.occurrences += 1;
    if (a.prNumber !== undefined) cluster.prs.add(a.prNumber);
    if (cluster.sampleBodies.length < MAX_SAMPLE_BODIES) {
      cluster.sampleBodies.push(a.finding.body);
    }
    if (a.observedAt < cluster.firstSeen) cluster.firstSeen = a.observedAt;
    if (a.observedAt > cluster.lastSeen) cluster.lastSeen = a.observedAt;
    if (a.finding.file && a.finding.file !== '(review body)') {
      if (cluster.paths.size < MAX_PATHS) cluster.paths.add(a.finding.file);
    }
  }

  // 6. Coverage filter against compiled rules
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  let compiledRules: Array<{ message: string }> = [];
  try {
    compiledRules = loadCompiledRules(rulesPath) as Array<{ message: string }>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(TAG, `Could not load compiled rules: ${msg} — coverage check disabled.`);
    compiledRules = [];
  }

  // Pre-tokenize rule messages once.
  const ruleTokenSets = compiledRules.map((r) => tokenizeForJaccard(r.message ?? ''));

  // 7. Materialize patterns
  const allPatterns: Array<{
    signature: string;
    tool: 'coderabbit' | 'gca' | 'sarif' | 'override' | 'mixed' | 'unknown';
    severityBucket: SeverityBucket;
    occurrences: number;
    prs: string[];
    sampleBodies: string[];
    firstSeen: string;
    lastSeen: string;
    paths: string[];
    coveredByRule: boolean;
  }> = [];

  for (const cluster of clusters.values()) {
    const tools = [...cluster.tools];
    const tool = tools.length > 1 ? 'mixed' : (tools[0] ?? 'unknown');
    const severityBucket = pickDominantSeverity(cluster.severityBuckets);

    // Coverage heuristic: max Jaccard across all rule messages ≥ 0.6
    const findingTokens = tokenizeForJaccard(cluster.normalizedBody);
    let maxJaccard = 0;
    for (const ruleTokens of ruleTokenSets) {
      const v = jaccard(findingTokens, ruleTokens);
      if (v > maxJaccard) maxJaccard = v;
    }
    const coveredByRule = maxJaccard >= COVERAGE_JACCARD_THRESHOLD;

    const prs = [...cluster.prs].sort((a, b) => Number(a) - Number(b));
    const paths = [...cluster.paths].sort((a, b) => a.localeCompare(b));

    allPatterns.push({
      signature: cluster.signature,
      tool,
      severityBucket,
      occurrences: cluster.occurrences,
      prs,
      sampleBodies: cluster.sampleBodies,
      firstSeen: cluster.firstSeen,
      lastSeen: cluster.lastSeen,
      paths,
      coveredByRule,
    });
  }

  // 8. Split into headline + covered, apply threshold to headline only
  const headlinePatterns = allPatterns
    .filter((p) => !p.coveredByRule)
    .filter((p) => p.occurrences >= threshold)
    .sort((a, b) => b.occurrences - a.occurrences);

  const coveredPatterns = allPatterns
    .filter((p) => p.coveredByRule)
    .sort((a, b) => b.occurrences - a.occurrences);

  // 9. Output preparation
  const outputPath = path.join(totemDir, 'recurrence-stats.json');
  const lastUpdated = new Date().toISOString();
  const stats = {
    version: 1 as const,
    lastUpdated,
    thresholdApplied: threshold,
    historyDepth,
    prsScanned,
    patterns: headlinePatterns,
    coveredPatterns,
  };

  // 10. Overwrite confirmation if file exists with newer lastUpdated
  if (fs.existsSync(outputPath)) {
    const existingNewer = await isExistingOutputNewer(outputPath, lastUpdated, log);
    if (existingNewer) {
      const proceed = await confirmOverwrite(outputPath, options.yes ?? false, log);
      if (!proceed) {
        log.warn(TAG, 'Overwrite declined; not writing recurrence-stats.json.');
        return;
      }
    }
  }

  // 11. Atomic write
  fs.mkdirSync(totemDir, { recursive: true });
  const tmp = outputPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(stats, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, outputPath);

  // 12. Stdout summary (via log → stderr; mirrors statsCommand voice)
  log.info(TAG, `Wrote ${outputPath}`);
  log.info(
    TAG,
    `Patterns at-or-above threshold ${threshold}: ${headlinePatterns.length} (covered: ${coveredPatterns.length}, scanned PRs: ${prsScanned.length}/${historyDepth}).`,
  );

  if (headlinePatterns.length > 0) {
    log.info(TAG, 'Top recurrences:');
    for (const p of headlinePatterns.slice(0, 5)) {
      const snippet = (p.sampleBodies[0] ?? '').replace(/\s+/g, ' ').slice(0, 80);
      log.dim(TAG, `  [${p.signature}] ${p.occurrences}x across ${p.prs.length} PR(s): ${snippet}`);
    }
  } else {
    log.dim(TAG, '  (none — all clusters below threshold or covered by existing rules)');
  }
}

// ─── Helpers ────────────────────────────────────────

interface MinimalThread {
  path: string;
  diffHunk: string;
  comments: { id?: number; author: string; body: string }[];
}

function groupThreadsByRoot(
  comments: Array<{
    id: number;
    author: string;
    body: string;
    path: string;
    diffHunk: string;
    inReplyToId?: number;
    createdAt?: string;
  }>,
): MinimalThread[] {
  const byId = new Map<number, (typeof comments)[number]>();
  for (const c of comments) byId.set(c.id, c);

  const threadMap = new Map<number, (typeof comments)[number][]>();
  for (const c of comments) {
    const rootId = c.inReplyToId ?? c.id;
    const thread = threadMap.get(rootId) ?? [];
    thread.push(c);
    threadMap.set(rootId, thread);
  }

  const threads: MinimalThread[] = [];
  for (const [rootId, threadComments] of threadMap) {
    threadComments.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return a.createdAt.localeCompare(b.createdAt);
    });
    const root = byId.get(rootId) ?? threadComments[0]!;
    threads.push({
      path: root.path,
      diffHunk: root.diffHunk,
      comments: threadComments.map((c) => ({ id: c.id, author: c.author, body: c.body })),
    });
  }
  return threads;
}

function clampThreshold(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input) || input < 1) return DEFAULT_THRESHOLD;
  return Math.floor(input);
}

function clampHistoryDepth(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input) || input < 1) return DEFAULT_HISTORY_DEPTH;
  return Math.min(MAX_HISTORY_DEPTH, Math.floor(input));
}

/** Pick the highest-severity bucket present in the cluster. */
function pickDominantSeverity(buckets: SeverityBucket[]): SeverityBucket {
  const order: SeverityBucket[] = ['critical', 'high', 'medium', 'low', 'nit'];
  for (const candidate of order) {
    if (buckets.includes(candidate)) return candidate;
  }
  return 'nit';
}

async function isExistingOutputNewer(
  outputPath: string,
  prospectiveTimestamp: string,
  log: { warn: (tag: string, msg: string) => void },
): Promise<boolean> {
  try {
    const raw = fs.readFileSync(outputPath, 'utf-8');
    const parsed = JSON.parse(raw) as { lastUpdated?: unknown };
    if (typeof parsed.lastUpdated !== 'string') return false;
    return parsed.lastUpdated > prospectiveTimestamp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(TAG, `Could not read existing recurrence-stats.json: ${msg}`);
    return false;
  }
}

async function confirmOverwrite(
  outputPath: string,
  yesFlag: boolean,
  log: { warn: (tag: string, msg: string) => void },
): Promise<boolean> {
  if (yesFlag) return true;
  if (!process.stdin.isTTY) {
    log.warn(
      TAG,
      `Existing ${outputPath} is newer; pass --yes to overwrite in non-interactive mode.`,
    );
    return false;
  }
  const { confirm, isCancel } = await import('@clack/prompts');
  const ans = await confirm({
    message: `Existing ${outputPath} is newer. Overwrite?`,
    initialValue: false,
  });
  if (isCancel(ans)) return false;
  return ans === true;
}
