/**
 * Declared-intent receipt + reconciliation for the auto-close enforcement seam
 * (mmnto-ai/totem#1762).
 *
 * D1 (PR-time required check) scans the PR corpus — title, description, and ALL
 * branch commit messages (config-verified: the governed repos compose squash
 * bodies from `COMMIT_MESSAGES`, so every branch commit is a squash-seed input)
 * — for close-keyword-adjacent refs via {@link findAutoCloseRefs}, and fails on
 * any ref that is not AUTHORIZED.
 *
 * AUTHORIZATION IS PROVENANCE-DISTINCT (codex #3 — the circularity fix). GitHub
 * DERIVES `closingIssuesReferences` FROM the PR body's own close keywords, so a
 * body keyword would self-whitelist against it. The ONLY authorizing channel is
 * therefore the provenance-distinct `totem-close` marker (an HTML comment or a
 * `Totem-Close:` trailer the author writes — see {@link parseDeclaredCloseIntent}).
 * `closingIssuesReferences` is recorded on the receipt as OBSERVED GitHub state
 * (informational), never as an authorization. Author workflow: declare every
 * intended close with the marker.
 *
 * D2 (post-merge reconciliation, OBSERVATION MODE) compares the merged HEAD
 * commit message against the receipt via {@link reconcile}. It alerts loud —
 * never auto-reopens — until positive+negative controls arm enforcement (the
 * Tenet 9 sense→enforce gate).
 *
 * Never scan issue/PR COMMENT bodies anywhere — comments never auto-close.
 */

import { autoCloseKeyForms, type AutoCloseMatch, findAutoCloseRefs } from './matcher.js';

// Bumped to 2 for the declaredByMarker / closingIssuesReferences split (the
// codex #3 circularity fix). No live v1 receipts exist (D1 is not yet deployed),
// so there is nothing to migrate; a stale-shape receipt fails isValidReceipt and
// D2 reports `ambiguous-receipt` (alert, never guess).
export const AUTO_CLOSE_RECEIPT_SCHEMA_VERSION = 2;

/**
 * A GitHub `closingIssuesReferences` node (from the PR GraphQL/REST API): the
 * issue GitHub itself recognizes as a linked closing reference for the PR.
 * OBSERVED state — informational only, NEVER authorizing (GitHub derives it from
 * body keywords).
 */
export interface ClosingIssueRef {
  number: number;
  /** `owner/repo` the issue lives in, when cross-repo; omitted for same-repo. */
  repoWithOwner?: string;
}

/**
 * The durable D1→D2 receipt. `declaredByMarker` is the AUTHORIZING set (marker
 * provenance only); `closingIssuesReferences` is OBSERVED GitHub state recorded
 * for the audit trail but not used to authorize. Persisted as a GitHub Actions
 * artifact keyed to the PR (see the D1 workflow script).
 */
export interface AutoCloseReceipt {
  schemaVersion: number;
  /** `owner/repo` the PR targets. */
  repo: string;
  prNumber: number;
  /** PR head SHA at D1 time (lets D2 correlate the artifact to the merge). */
  headSha: string;
  /**
   * AUTHORIZING set: normalized keys declared via the provenance-distinct
   * `totem-close` marker/trailer ONLY. reconcile authorizes against THIS set.
   */
  declaredByMarker: string[];
  /**
   * INFORMATIONAL: GitHub's derived `closingIssuesReferences` (normalized keys).
   * Recorded for the audit trail; NOT authorizing (breaks the self-whitelist
   * circularity — codex #3).
   */
  closingIssuesReferences: string[];
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

// The provenance-distinct authorization channel: an author who intends a
// close-keyword ref declares it either as an HTML comment
// `<!-- totem-close: #N, owner/repo#M -->` or a git trailer `Totem-Close: #N`.
// This is the ONLY authorizing channel (closingIssuesReferences is GitHub-derived
// and thus self-whitelisting — codex #3).
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

/**
 * Strip structured-intent markers so a marker's own refs never read as a finding.
 * The marker text `totem-close: #N` itself contains `close: #N` — a
 * keyword-adjacent ref — so this MUST run before {@link findAutoCloseRefs}, or a
 * marker would self-flag (verified by test).
 */
function stripIntentMarkers(text: string): string {
  return text
    .replace(/<!--\s*totem-close:[^>]*-->/gi, ' ')
    .replace(/^[ \t]*totem-close:.*$/gim, ' ');
}

/** Normalize a set of refs to their comparison-key set (union of equivalence forms). */
function keysFromRefs(refs: { qualifier?: string; issue: number }[], repo: string): string[] {
  const keys = new Set<string>();
  for (const r of refs) for (const k of autoCloseKeyForms(r, repo)) keys.add(k);
  return [...keys];
}

/** Normalize GitHub's closingIssuesReferences to comparison keys (informational). */
function keysFromClosingRefs(closing: ClosingIssueRef[], repo: string): string[] {
  return keysFromRefs(
    closing.map((c) => ({
      ...(c.repoWithOwner ? { qualifier: c.repoWithOwner } : {}),
      issue: c.number,
    })),
    repo,
  );
}

/** The D1 corpus surfaces (never includes comment bodies). */
export interface PrCorpus {
  title: string;
  body: string;
  commitMessages: string[];
  closingIssuesReferences: ClosingIssueRef[];
  repo: string;
}

/** Result of the D1 corpus scan. `ok` iff nothing unauthorized was found. */
export interface PrScanResult {
  ok: boolean;
  /** Normalized keys found across the corpus. */
  findings: string[];
  /** AUTHORIZING set (marker-declared only) — the receipt payload. */
  declaredByMarker: string[];
  /** INFORMATIONAL: GitHub's derived closingIssuesReferences (normalized keys). */
  closingIssuesReferences: string[];
  /** Findings not authorized by the marker set — these fail the check. */
  undeclared: string[];
}

/** Is any equivalence-form of `match` present in the authorizing set? */
function isDeclared(match: AutoCloseMatch, declared: Set<string>, repo: string): boolean {
  return autoCloseKeyForms(match, repo).some((k) => declared.has(k));
}

/**
 * D1: scan the PR corpus (title + body + every branch commit message) for
 * close-keyword-adjacent refs and split them into authorized vs undeclared. A
 * finding is authorized ONLY by the provenance-distinct `totem-close` marker —
 * NOT by GitHub's `closingIssuesReferences` (which GitHub derives from the same
 * body keywords, so it would self-whitelist; codex #3). Comment bodies are NEVER
 * part of the corpus.
 */
export function scanPrCorpus(corpus: PrCorpus): PrScanResult {
  const surfaces = [corpus.title, corpus.body, ...corpus.commitMessages].map((s) =>
    typeof s === 'string' ? s : '',
  );
  const intent = parseDeclaredCloseIntent(surfaces.join('\n'));
  const declaredByMarker = keysFromRefs(intent, corpus.repo);
  const closingIssuesReferences = keysFromClosingRefs(corpus.closingIssuesReferences, corpus.repo);
  const authorizingSet = new Set(declaredByMarker.map((k) => k.toLowerCase()));

  const matches = surfaces.flatMap((s) => findAutoCloseRefs(stripIntentMarkers(s)));
  const findings = dedupe(matches.map((m) => m.ref));
  const undeclared = dedupe(
    matches.filter((m) => !isDeclared(m, authorizingSet, corpus.repo)).map((m) => m.ref),
  );

  return {
    ok: undeclared.length === 0,
    findings,
    declaredByMarker,
    closingIssuesReferences,
    undeclared,
  };
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
    declaredByMarker: scan.declaredByMarker,
    closingIssuesReferences: scan.closingIssuesReferences,
    corpusFindings: scan.findings,
    generatedAt: now.toISOString(),
    note:
      'Declared-intended-close receipt for the auto-close enforcement seam ' +
      '(mmnto-ai/totem#1762). D2 authorizes the merged HEAD message against ' +
      'declaredByMarker ONLY (closingIssuesReferences is GitHub-derived / ' +
      'informational). Absent receipt + a closure-capable body => alert, never guess.',
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
  /** Findings not covered by the receipt's authorizing set (the anomaly set). */
  undeclared: string[];
  /**
   * OBSERVATION MODE: the issues an armed enforcer WOULD reopen. Reported for the
   * audit trail; D2 never acts on it (no auto-reopen until controls pass).
   */
  reopenCandidates: string[];
  /**
   * Whether the merged commit carried a non-empty BODY after RFC-822 trailer
   * lines are stripped (mmnto-ai/totem#1762 addendum + the 0330Z trailer-strip
   * fold-in). Under the E lever (squash message = BLANK) the body should be
   * empty; a non-empty non-trailer body is the posture signal (`unexpected-body`).
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
    Array.isArray(o['declaredByMarker']) &&
    (o['declaredByMarker'] as unknown[]).every((k) => typeof k === 'string')
  );
}

/**
 * D2: reconcile the merged HEAD commit message against the D1 receipt.
 * OBSERVATION MODE — every non-clean outcome ALERTS (the caller decides exit
 * code); NONE reopens.
 *
 *   - `clean`            — no close-keyword-adjacent ref, or every ref is
 *                          authorized. Quiet path (empty / trailer-only body).
 *   - `anomaly`          — a closure-capable message with ≥1 UNAUTHORIZED ref.
 *                          The zero-allowed-set (`declaredByMarker: []`) + a
 *                          closure-capable message is the #2471 specimen.
 *   - `missing-receipt`  — a closure-capable message but NO receipt (PR merged
 *                          before D1 existed, or the artifact expired /
 *                          could not be downloaded). Alert, never guess.
 *   - `ambiguous-receipt`— a closure-capable message but the receipt is malformed
 *                          or is for a different PR. Alert, never guess.
 *   - `unexpected-body`  — a non-empty non-trailer body under BLANK with NO
 *                          unauthorized ref: posture-drift / `--body`-override
 *                          evidence (no closure harm). The caller surfaces it as
 *                          a non-failing signal (interpretation call).
 */
export function reconcile(
  receipt: AutoCloseReceipt | null,
  mergedBody: string,
  opts: ReconcileOptions = {},
): ReconcileResult {
  const message = mergedBody ?? '';
  // Body-presence FIRST (E-lever addendum, mmnto-ai/totem#1762): under the BLANK
  // squash posture the server composes no prose body — but RFC-822 attribution
  // trailers (Co-authored-by / Signed-off-by) DO survive (0330Z, first live
  // merge), so presence is evaluated on the body AFTER trailer-strip. The content
  // scan runs over the whole message — a close-keyword ref in the SUBJECT (now
  // deterministically the PR_TITLE) still auto-closes.
  const bodyPresent = messageBody(message).length > 0;

  // Content scan / harm axis: an UNAUTHORIZED close-keyword ref is the
  // top-severity alert (the accidental-closure harm) and always wins.
  const harm = evaluateContent(receipt, message, bodyPresent, opts);
  if (harm.status !== 'clean') return harm;

  // No unauthorized close-keyword harm. A non-empty non-trailer body under BLANK
  // is the posture signal: only a local `gh pr merge --body` override (the
  // confirmed-vector class), a config-drift regression, or a non-squash merge
  // produces one. INTERPRETATION CALL (E-lever addendum): surfaced as
  // posture-drift EVIDENCE (`unexpected-body`), distinct from a hard close-anomaly
  // (no issue-closure harm), with NO reopen candidates.
  if (bodyPresent) {
    return {
      status: 'unexpected-body',
      findings: harm.findings,
      undeclared: [],
      reopenCandidates: [],
      bodyPresent: true,
      message:
        `Merged commit carries a NON-EMPTY body (after trailer-strip) under the BLANK squash ` +
        `posture (findings: ${harm.findings.length > 0 ? harm.findings.join(', ') : 'none'}). No ` +
        'unauthorized close-keyword ref, so no accidental-closure harm — but under BLANK the ' +
        'server composes no body, so this is posture-drift / local `--body`-override evidence ' +
        '(the confirmed-vector fingerprint — triage it, do not ignore). Surfaced (observation ' +
        'mode; no auto-reopen). Verify the merge-config posture (D1 asserts it) and that no local ' +
        '`--body` override was used. mmnto-ai/totem#1762.',
    };
  }

  return { ...harm };
}

/**
 * The content/harm axis of {@link reconcile}: scan the whole merged message
 * (subject + body) for close-keyword refs and authorize them against the
 * receipt's marker set. Returns `clean` | `anomaly` | `missing-receipt` |
 * `ambiguous-receipt` only — the `unexpected-body` posture leaf is decided by
 * {@link reconcile}.
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

  // Authorize against the MARKER set only (closingIssuesReferences is
  // informational — codex #3 circularity fix).
  const authorizingSet = new Set(receipt.declaredByMarker.map((k) => k.toLowerCase()));
  const undeclared = dedupe(
    matches.filter((m) => !isDeclared(m, authorizingSet, repo ?? receipt.repo)).map((m) => m.ref),
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
        `authorize ${undeclared.length > 1 ? 'them' : 'it'} via a totem-close marker ` +
        `(marker-authorized: ${receipt.declaredByMarker.length === 0 ? '[] (zero-allowed-set)' : receipt.declaredByMarker.join(', ')}). ` +
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
    message: `All closes in the merged message (${findings.join(', ')}) were marker-authorized at PR time.`,
  };
}

/** RFC-822-style trailer line (`Co-authored-by:`, `Signed-off-by:`, and kin). */
const TRAILER_LINE_RE = /^[A-Za-z][A-Za-z-]*:\s/;

/** Strip RFC-822 trailer lines so an attribution-only body reads as empty (0330Z). */
function stripTrailerLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !TRAILER_LINE_RE.test(line))
    .join('\n');
}

/**
 * The commit BODY presence surface — content after the first line (the subject),
 * with RFC-822 attribution trailers stripped, then trimmed. Under BLANK a
 * co-authored / dependabot squash body is trailers-only → reads as empty → clean
 * (0330Z: those trailers survive the BLANK message setting).
 */
function messageBody(message: string): string {
  const nl = message.indexOf('\n');
  const rawBody = nl === -1 ? '' : message.slice(nl + 1);
  return stripTrailerLines(rawBody).trim();
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
