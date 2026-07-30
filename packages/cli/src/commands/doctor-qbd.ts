/**
 * `totem doctor --compliance` — query-before-derive section (mmnto-ai/totem#2510).
 *
 * Renders ONE number: of the derive-class actions in an agent session (spec
 * synthesis, orientation derivation, review grounding), what fraction was
 * preceded by a corpus query correlated to that action — plus its trend and the
 * pre-registered threshold it will be judged against.
 *
 * Sensor, not actuator (Tenet 13): this section renders and returns. It never
 * throws for a compliance verdict and never influences the exit code. Nothing
 * in Totem blocks on this number in v1, by charter.
 *
 * Reads alongside the existing ADR-029 recall-compliance section rather than
 * replacing it: that metric is search-before-COMMIT at commit granularity; this
 * one is query-before-DERIVE at event granularity with explicit correlation IDs.
 * Different denominators, different claims, both printed under `--compliance`.
 */

const TAG = 'Compliance';

/** Ledger location, relative to the resolved totemDir. */
const LEDGER_RELATIVE_PATH = ['ledger', 'events.ndjson'];

export interface QbdComplianceCliOptions {
  /** Test seam — production callers omit and the command uses `process.cwd()`. */
  cwdForTest?: string;
  /** Test seam — inject raw ledger NDJSON instead of reading from disk. */
  ledgerContentForTest?: string;
}

/**
 * Render the query-before-derive compliance section.
 *
 * Degraded-read contract (ADR-115 § 2): a scan that hit malformed lines,
 * correlation-contract violations, or unjoinable correlation IDs renders under
 * an explicit `DEGRADED` / `UNVERIFIED` envelope with per-item counts. A broken
 * ledger scan must never render like a clean 100% or a clean 0% — that
 * indistinguishability IS the defect class, not an acceptable degradation.
 */
export async function doctorQbdComplianceCommand(
  options: QbdComplianceCliOptions = {},
): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    computeQbdCompliance,
    formatQbdRate,
    QBD_PRE_REGISTERED_WINDOW_SESSIONS,
    QBD_PRE_REGISTRATION_STATEMENT,
    sanitizeForTerminal,
    scanQbdLedger,
  } = await import('@mmnto/totem');
  const { bold, log } = await import('../ui.js');

  const cwd = options.cwdForTest ?? process.cwd();

  // Resolve totemDir best-effort; default `.totem` (mirrors the sibling doctor
  // sections, which never hard-fail on a config-less repo).
  let totemDir = '.totem';
  try {
    const { loadConfig, resolveConfigPath } = await import('../utils.js');
    const config = await loadConfig(resolveConfigPath(cwd));
    totemDir = config.totemDir;
    // totem-context: a missing/corrupt config is the honest-absent path (default `.totem`), not a sensor failure — the doctor runs against config-less repos by design.
  } catch (err) {
    if (err instanceof Error && err.message.length === 0) throw err;
  }

  const ledgerPath = path.join(cwd, totemDir, ...LEDGER_RELATIVE_PATH);
  // totemDir is repo-controlled config — sanitize before it reaches a terminal.
  const displayPath = sanitizeForTerminal(path.join(totemDir, ...LEDGER_RELATIVE_PATH));

  log.info(TAG, bold('Query-before-derive compliance'));

  let content: string;
  if (options.ledgerContentForTest !== undefined) {
    content = options.ledgerContentForTest;
  } else if (!fs.existsSync(ledgerPath)) {
    // Absent ledger → skip idiom. NOT a fail, and emphatically NOT 0%.
    log.dim(
      TAG,
      `SKIP — no ${displayPath} found. Query-before-derive rows are written by \`totem search\`, the MCP search_knowledge tool, and the derive-class commands (spec / orient / review); run some, then re-run totem doctor --compliance.`,
    );
    return;
  } else {
    try {
      content = fs.readFileSync(ledgerPath, 'utf-8');
      // totem-context: an unreadable ledger is the honest-absent path for this read-only sensor — degrade to the skip idiom, never crash the doctor pipeline.
    } catch {
      log.dim(TAG, `SKIP — ${displayPath} present but unreadable.`);
      return;
    }
  }

  const scan = scanQbdLedger(content);
  const report = computeQbdCompliance(scan);

  // ── Degraded envelope FIRST, so the number is never read bare ──
  if (report.degraded) {
    log.warn(
      TAG,
      `DEGRADED — the ledger scan hit rows it could not trust; the compliance number below is UNVERIFIED`,
    );
    const a = report.anomalies;
    if (a.malformedJson > 0) log.warn(TAG, `  ${a.malformedJson} malformed JSON line(s)`);
    if (a.correlationContractViolations > 0) {
      log.warn(
        TAG,
        `  ${a.correlationContractViolations} correlation-contract violation(s) — an ID that could not have been minted when its row was written (backfill)`,
      );
    }
    if (a.unclassifiedInvalid > 0) {
      log.warn(TAG, `  ${a.unclassifiedInvalid} unclassifiable invalid row(s)`);
    }
    if (a.orphanCorrelations > 0) {
      log.warn(
        TAG,
        `  ${a.orphanCorrelations} derive(s) citing a correlation ID with no preceding query row`,
      );
    }
    if (a.crossSessionCorrelations > 0) {
      log.warn(
        TAG,
        `  ${a.crossSessionCorrelations} derive(s) correlated to a query from another session`,
      );
    }
    for (const detail of a.details) log.dim(TAG, `  · ${sanitizeForTerminal(detail)}`);
  }

  // ── The number ──
  const label = report.degraded ? 'compliance (UNVERIFIED)' : 'compliance';
  log.info(
    TAG,
    `${label}: ${formatQbdRate(report.window)} over ${report.evaluatedSessions} instrumented session(s)`,
  );

  // ── Pre-registration, verbatim (charter requirement) ──
  log.dim(TAG, `pre-registered threshold + window: ${QBD_PRE_REGISTRATION_STATEMENT}`);

  if (report.verdict === 'PENDING') {
    log.dim(
      TAG,
      `verdict: PENDING — ${report.instrumentedSessions}/${QBD_PRE_REGISTERED_WINDOW_SESSIONS} instrumented sessions recorded; the threshold is not evaluable until the window fills`,
    );
  } else if (report.verdict === 'PASS') {
    log.success(TAG, `verdict: PASS — at or above the pre-registered floor over the window`);
  } else {
    log.warn(
      TAG,
      `verdict: FAIL — below the pre-registered floor over the window. Per the #2510 pre-registration the adherence claims' Goal: prefixes are recorded as FALSIFIED for this window, and this number leads the next signoff.`,
    );
  }

  // ── Trend ──
  if (report.trend === null) {
    log.dim(TAG, 'trend: insufficient data (needs at least 4 instrumented sessions)');
  } else {
    log.dim(
      TAG,
      `trend: earlier ${formatQbdRate(report.trend.earlier)} → recent ${formatQbdRate(report.trend.recent)}`,
    );
  }

  // ── Honest limitation (#2510 falsifier 4) ──
  log.dim(
    TAG,
    'limitation: this senses query-before-derive ADJACENCY, not influence — a query whose results the derive never read still counts as compliant (ritual-query / Goodhart). Named, not solved.',
  );
}
