/**
 * Declared-intent receipt + reconciliation for the auto-close enforcement seam
 * (mmnto-ai/totem#1762).
 *
 * D1 (PR-time required check) scans the PR corpus — title, description, and ALL
 * branch commit messages (config-verified: the governed repos compose squash
 * bodies from `COMMIT_MESSAGES`, so every branch commit is a squash-seed input)
 * — for close-keyword-adjacent refs via {@link findAutoCloseRefs}, and fails on
 * any ref that is not DECLARED. The declared-intended-close set is
 * `closingIssuesReferences` (GitHub's native linked-issue channel) ∪ a
 * structured-intent declaration (see {@link parseDeclaredCloseIntent}). D1
 * persists that set as an {@link AutoCloseReceipt} for D2 to reconcile against.
 *
 * D2 (post-merge reconciliation, OBSERVATION MODE) compares the merged HEAD
 * commit body against the receipt via {@link reconcile}. It alerts loud — never
 * auto-reopens — until positive+negative controls arm enforcement (the Tenet 9
 * sense→enforce gate).
 *
 * Never scan issue/PR COMMENT bodies anywhere — comments never auto-close.
 */

import { autoCloseKeyForms, type AutoCloseMatch, findAutoCloseRefs } from './matcher.js';

export const AUTO_CLOSE_RECEIPT_SCHEMA_VERSION = 1;

/**
 * A GitHub `closingIssuesReferences` node (from the PR GraphQL/REST API): the
 * issue GitHub itself recognizes as a linked closing reference for the PR.
 */
export interface ClosingIssueRef {
  number: number;
  /** `owner/repo` the issue lives in, when cross-repo; omitted for same-repo. */
  repoWithOwner?: string;
}

/**
 * The durable D1→D2 receipt: the declared-intended-close set at PR-time, plus an
 * audit trail of what the corpus scan found. Persisted as a GitHub Actions
 * artifact keyed to the PR (see the D1 workflow script).
 */
export interface AutoCloseReceipt {
  schemaVersion: number;
  /** `owner/repo` the PR targets. */
  repo: string;
  prNumber: number;
  /** PR head SHA at D1 time (lets D2 correlate the artifact to the merge). */
  headSha: string;
  /** Normalized keys allowed to be closed (declared intent). */
  declaredCloseKeys: string[];
  /** Normalized keys the D1 corpus scan found (audit only). */
  corpusFindings: string[];
  generatedAt: string;
  note: string;
}

/** A structured-intent reference the author explicitly declared. */
export interface DeclaredIntentRef {
  qualifier?: string;
  issue: number;
}

// The structured-intent channel I design for this seam: an author who genuinely
// intends a close-keyword ref that is NOT otherwise linked declares it either as
// an HTML comment `<!-- totem-close: #N, owner/repo#M -->` or a git trailer
// `Totem-Close: #N`. The PRIMARY channel remains closingIssuesReferences.
const INTENT_MARKER_RE = /<!--\s*totem-close:\s*([^>]*?)\s*-->|^[ \t]*totem-close:[ \t]*(.+)$/gim;
const INTENT_REF_RE = /([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#(\d+)/g;

/**
 * Parse the structured-intent declarations out of `text`. Returns the refs the
 * author explicitly whitelisted for closure. Does NOT interpret close keywords —
 * a marker carries bare/qualified refs only.
 */
export function parseDeclaredCloseIntent(text: string): DeclaredIntentRef[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out: DeclaredIntentRef[] = [];
  for (const marker of text.matchAll(INTENT_MARKER_RE)) {
    const inner = marker[1] ?? marker[2] ?? '';
    for (const ref of inner.matchAll(INTENT_REF_RE)) {
      const issue = Number(ref[2]);
      if (!Number.isFinite(issue)) continue;
      out.push({ ...(ref[1] ? { qualifier: ref[1] } : {}), issue });
    }
  }
  return out;
}

/** Strip structured-intent markers so a marker's own refs never read as a finding. */
function stripIntentMarkers(text: string): string {
  return text
    .replace(/<!--\s*totem-close:[^>]*-->/gi, ' ')
    .replace(/^[ \t]*totem-close:.*$/gim, ' ');
}

/**
 * Build the normalized declared-intended-close key set from the two declared
 * channels. Same-repo and self-qualified forms are BOTH added so a bare `#N`
 * body ref reconciles against a qualified declaration and vice-versa.
 */
export function buildDeclaredCloseKeys(
  closingIssuesReferences: ClosingIssueRef[],
  intent: DeclaredIntentRef[],
  repo: string,
): string[] {
  const keys = new Set<string>();
  for (const c of closingIssuesReferences) {
    const ref = { ...(c.repoWithOwner ? { qualifier: c.repoWithOwner } : {}), issue: c.number };
    for (const k of autoCloseKeyForms(ref, repo)) keys.add(k);
  }
  for (const i of intent) {
    for (const k of autoCloseKeyForms(i, repo)) keys.add(k);
  }
  return [...keys];
}

/** The D1 corpus surfaces (never includes comment bodies). */
export interface PrCorpus {
  title: string;
  body: string;
  commitMessages: string[];
  closingIssuesReferences: ClosingIssueRef[];
  repo: string;
}

/** Result of the D1 corpus scan. `ok` iff nothing undeclared was found. */
export interface PrScanResult {
  ok: boolean;
  /** Normalized keys found across the corpus. */
  findings: string[];
  /** The declared-intended-close set (the receipt payload). */
  declaredCloseKeys: string[];
  /** Findings whose key is not in the declared set — these fail the check. */
  undeclared: string[];
}

/** Is any equivalence-form of `match` present in the declared set? */
function isDeclared(match: AutoCloseMatch, declared: Set<string>, repo: string): boolean {
  return autoCloseKeyForms(match, repo).some((k) => declared.has(k));
}

/**
 * D1: scan the PR corpus (title + body + every branch commit message) for
 * close-keyword-adjacent refs and split them into declared vs undeclared against
 * `closingIssuesReferences` ∪ structured intent. Comment bodies are NEVER part
 * of the corpus.
 */
export function scanPrCorpus(corpus: PrCorpus): PrScanResult {
  const surfaces = [corpus.title, corpus.body, ...corpus.commitMessages].map((s) =>
    typeof s === 'string' ? s : '',
  );
  const intent = parseDeclaredCloseIntent(surfaces.join('\n'));
  const declaredCloseKeys = buildDeclaredCloseKeys(
    corpus.closingIssuesReferences,
    intent,
    corpus.repo,
  );
  const declaredSet = new Set(declaredCloseKeys.map((k) => k.toLowerCase()));

  const matches = surfaces.flatMap((s) => findAutoCloseRefs(stripIntentMarkers(s)));
  const findings = dedupe(matches.map((m) => m.ref));
  const undeclared = dedupe(
    matches.filter((m) => !isDeclared(m, declaredSet, corpus.repo)).map((m) => m.ref),
  );

  return { ok: undeclared.length === 0, findings, declaredCloseKeys, undeclared };
}

/** Assemble the durable D1 receipt from a corpus scan. */
export function buildReceipt(
  corpus: Pick<PrCorpus, 'repo'>,
  prNumber: number,
  headSha: string,
  scan: PrScanResult,
  now: Date = new Date(),
): AutoCloseReceipt {
  return {
    schemaVersion: AUTO_CLOSE_RECEIPT_SCHEMA_VERSION,
    repo: corpus.repo,
    prNumber,
    headSha,
    declaredCloseKeys: scan.declaredCloseKeys,
    corpusFindings: scan.findings,
    generatedAt: now.toISOString(),
    note:
      'Declared-intended-close receipt for the auto-close enforcement seam ' +
      '(mmnto-ai/totem#1762). D2 reconciles the merged HEAD body against ' +
      'declaredCloseKeys. Absent receipt + a closure-capable body => alert, never guess.',
  };
}

export type ReconcileStatus =
  | 'clean'
  | 'anomaly'
  | 'missing-receipt'
  | 'ambiguous-receipt'
  | 'unexpected-body';

export interface ReconcileResult {
  status: ReconcileStatus;
  /** Normalized keys found in the merged commit message. */
  findings: string[];
  /** Findings not covered by the receipt's declared set (the anomaly set). */
  undeclared: string[];
  /**
   * OBSERVATION MODE: the issues an armed enforcer WOULD reopen. Reported for the
   * audit trail; D2 never acts on it (no auto-reopen until controls pass).
   */
  reopenCandidates: string[];
  /**
   * Whether the merged commit carried a non-empty BODY (content after the subject
   * line). Under the E lever (squash message = BLANK, mmnto-ai/totem#1762
   * addendum) the body should be empty; a non-empty body is itself the posture
   * signal (`unexpected-body`).
   */
  bodyPresent: boolean;
  /** Precise operator-facing message for the job log. */
  message: string;
}

/** Options for {@link reconcile}. */
export interface ReconcileOptions {
  /** `owner/repo` the merge landed on (enables same-repo key equivalence). */
  repo?: string;
  /** Expected PR number — a receipt for a different PR is ambiguous. */
  expectedPrNumber?: number;
}

function isValidReceipt(r: unknown): r is AutoCloseReceipt {
  if (r === null || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o['schemaVersion'] === 'number' &&
    Array.isArray(o['declaredCloseKeys']) &&
    (o['declaredCloseKeys'] as unknown[]).every((k) => typeof k === 'string')
  );
}

/**
 * D2: reconcile the merged HEAD commit body against the D1 receipt. OBSERVATION
 * MODE — every non-clean outcome ALERTS (the caller fails the job); NONE reopens.
 *
 *   - `clean`            — no close-keyword-adjacent ref in the body (receipt
 *                          irrelevant), or every ref is declared. Quiet path:
 *                          an ordinary merge with no closure prose never fails.
 *   - `anomaly`          — a closure-capable body with ≥1 UNDECLARED ref. The
 *                          zero-allowed-set (`declaredCloseKeys: []`) + a
 *                          closure-capable body is this case — the #2471
 *                          specimen.
 *   - `missing-receipt`  — a closure-capable body but NO receipt (PR merged
 *                          before D1 existed, or the artifact expired /
 *                          could not be downloaded). Alert, never guess.
 *   - `ambiguous-receipt`— a closure-capable body but the receipt is malformed
 *                          or is for a different PR. Alert, never guess.
 */
export function reconcile(
  receipt: AutoCloseReceipt | null,
  mergedBody: string,
  opts: ReconcileOptions = {},
): ReconcileResult {
  const message = mergedBody ?? '';
  // Body-presence FIRST (E-lever addendum, mmnto-ai/totem#1762): under the BLANK
  // squash posture the server composes no body, so a non-empty body is itself the
  // posture signal. The content scan runs regardless — a close-keyword ref in the
  // SUBJECT (now deterministically the PR_TITLE) still auto-closes.
  const bodyPresent = messageBody(message).length > 0;

  // Content scan / harm axis: an UNDECLARED close-keyword ref is the top-severity
  // alert (the accidental-closure harm) and always wins over the posture signal.
  const harm = evaluateContent(receipt, message, bodyPresent, opts);
  if (harm.status !== 'clean') return harm;

  // No undeclared close-keyword harm. A non-empty body under BLANK is the posture
  // signal: only a local `gh pr merge --body` override (the confirmed-vector
  // class), a config-drift regression, or a non-squash merge produces one.
  // INTERPRETATION CALL (E-lever addendum): a non-empty-but-keyword-free body is
  // surfaced as posture-drift EVIDENCE (`unexpected-body`) — distinct from a hard
  // close-anomaly, since no issue-closure harm occurred. It carries NO reopen
  // candidates. The D2 script surfaces it as a NON-failing annotation (not
  // silent, not a false CI failure on a rare legitimate authored body).
  if (bodyPresent) {
    return {
      status: 'unexpected-body',
      findings: harm.findings,
      undeclared: [],
      reopenCandidates: [],
      bodyPresent: true,
      message:
        `Merged commit carries a NON-EMPTY body under the BLANK squash posture (findings: ${
          harm.findings.length > 0 ? harm.findings.join(', ') : 'none'
        }). No undeclared close-keyword ref, so no accidental-closure harm — but under BLANK the ` +
        'server composes no body, so this is posture-drift / local `--body`-override evidence. ' +
        'Surfaced (observation mode; no auto-reopen). Verify the merge-config posture (D1 asserts ' +
        'it) and that no local `--body` override was used. mmnto-ai/totem#1762.',
    };
  }

  return { ...harm, message: harm.message };
}

/**
 * The content/harm axis of {@link reconcile}: scan the whole merged message
 * (subject + body) for close-keyword refs and reconcile them against the receipt.
 * Returns `clean` | `anomaly` | `missing-receipt` | `ambiguous-receipt` only — the
 * `unexpected-body` posture leaf is decided by {@link reconcile}.
 */
function evaluateContent(
  receipt: AutoCloseReceipt | null,
  message: string,
  bodyPresent: boolean,
  opts: ReconcileOptions,
): ReconcileResult {
  const repo = opts.repo;
  const matches = findAutoCloseRefs(stripIntentMarkers(message));
  const findings = dedupe(matches.map((m) => m.ref));

  if (matches.length === 0) {
    return {
      status: 'clean',
      findings,
      undeclared: [],
      reopenCandidates: [],
      bodyPresent,
      message: 'No close-keyword-adjacent issue reference in the merged commit message.',
    };
  }

  // A closure-capable message with no usable receipt: alert, never guess.
  if (receipt === null || !isValidReceipt(receipt)) {
    const why = receipt === null ? 'missing-receipt' : 'ambiguous-receipt';
    return {
      status: why,
      findings,
      undeclared: findings,
      reopenCandidates: findings,
      bodyPresent,
      message:
        `Merged message closes ${findings.join(', ')} but the D1 receipt is ` +
        `${receipt === null ? 'ABSENT' : 'MALFORMED'} — cannot verify intent. ` +
        'Alerting (observation mode; no auto-reopen). Verify the closure was intended; ' +
        'if not, `gh issue reopen <n>`.',
    };
  }

  if (opts.expectedPrNumber !== undefined && receipt.prNumber !== opts.expectedPrNumber) {
    return {
      status: 'ambiguous-receipt',
      findings,
      undeclared: findings,
      reopenCandidates: findings,
      bodyPresent,
      message:
        `Merged message closes ${findings.join(', ')} but the fetched receipt is for ` +
        `PR #${receipt.prNumber}, not the merged PR #${opts.expectedPrNumber} — ` +
        'cannot verify intent. Alerting (observation mode; no auto-reopen).',
    };
  }

  const declaredSet = new Set(receipt.declaredCloseKeys.map((k) => k.toLowerCase()));
  const undeclared = dedupe(
    matches.filter((m) => !isDeclared(m, declaredSet, repo ?? receipt.repo)).map((m) => m.ref),
  );

  if (undeclared.length > 0) {
    return {
      status: 'anomaly',
      findings,
      undeclared,
      reopenCandidates: undeclared,
      bodyPresent,
      message:
        `Merged message closes ${undeclared.join(', ')} but the D1 receipt did NOT ` +
        `declare ${undeclared.length > 1 ? 'them' : 'it'} ` +
        `(declared: ${receipt.declaredCloseKeys.length === 0 ? '[] (zero-allowed-set)' : receipt.declaredCloseKeys.join(', ')}). ` +
        'This is an accidental-closure anomaly. Alerting (observation mode; no auto-reopen). ' +
        'If the closure was unintended, `gh issue reopen <n>`.',
    };
  }

  return {
    status: 'clean',
    findings,
    undeclared: [],
    reopenCandidates: [],
    bodyPresent,
    message: `All closes in the merged message (${findings.join(', ')}) were declared at PR time.`,
  };
}

/** The commit BODY — content after the first line (the subject), trimmed. */
function messageBody(message: string): string {
  const nl = message.indexOf('\n');
  return nl === -1 ? '' : message.slice(nl + 1).trim();
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
