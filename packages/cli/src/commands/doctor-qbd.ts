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
  /**
   * Test seam — point global-profile resolution at a temp home. Without it a
   * test in a config-less directory resolves the developer's REAL `~/.totem/`
   * profile and reads (or, on the write side, writes) their live ledger.
   */
  homeDirForTest?: string;
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

  // Resolve the ledger through the SAME helper the write seams use, so the
  // reader can never look somewhere the writers do not write (they diverged
  // once already: seams joined `cwd`, which misses the project ledger whenever
  // a command runs from a subdirectory).
  //
  // There is deliberately NO `?? path.join(cwd, '.totem')` fallback. The writers
  // SKIP when config is unresolved, so a reader that fell back to `<cwd>/.totem`
  // would read a ledger no writer ever writes — reviving the exact divergence
  // the comment above claims is closed, and letting a stale directory render as
  // if it were this project's data. Unresolved is its own honest state.
  const { resolveQbdLedgerDirDetailed } = await import('./qbd-seam.js');
  const resolved = await resolveQbdLedgerDirDetailed(cwd, options.homeDirForTest);
  if (resolved.dir === undefined) {
    log.info(TAG, bold('Query-before-derive compliance'));
    log.dim(
      TAG,
      `SKIP — ${resolved.reason ?? 'no ledger could be resolved'}. Nothing is recorded from here either, so there is nothing to read.`,
    );
    return;
  }
  const totemDir = resolved.dir;

  const ledgerPath = path.join(totemDir, ...LEDGER_RELATIVE_PATH);
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
    } catch (err) {
      // Name the errno. EACCES (permissions), EISDIR (a directory where the
      // file belongs), and ENOTDIR (a component is a file) are three different
      // problems with three different fixes; collapsing them into "unreadable"
      // tells the reader nothing actionable.
      const code =
        typeof err === 'object' && err !== null
          ? ((err as NodeJS.ErrnoException).code ?? 'unknown')
          : 'unknown';
      log.dim(TAG, `SKIP — ${displayPath} present but unreadable (${code}).`);
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
        `  ${a.crossSessionCorrelations} derive(s) correlated to a query from another session or seat`,
      );
    }
    if (a.duplicateCorrelations > 0) {
      log.warn(
        TAG,
        `  ${a.duplicateCorrelations} derive(s) re-citing a correlation ID an earlier derive already spent (one query grounds one derive)`,
      );
    }
    if (a.backdatedRows > 0) {
      log.warn(
        TAG,
        `  ${a.backdatedRows} row(s) with timestamps regressing in an append-only ledger (backdated append)`,
      );
    }
    for (const detail of a.details) log.dim(TAG, `  · ${sanitizeForTerminal(detail)}`);

    // Remediation. Degraded is sticky by design — one bad row degrades the whole
    // read, and neither the row nor the verdict expires — so without this the
    // envelope is a permanent unactionable banner. Say which file to open.
    log.dim(
      TAG,
      `  to clear: inspect the cited line numbers in ${displayPath} (append-only — repair by appending corrections, never by rewriting history), then re-run.`,
    );
  }

  // Seat-plumbing hint — deliberately OUTSIDE the degraded envelope: one-sided
  // seat plumbing is a config smell, not evidence of tampering.
  if (report.anomalies.seatMismatchHints > 0) {
    log.dim(
      TAG,
      `note: ${report.anomalies.seatMismatchHints} uncorrelated derive(s) had an in-window query from a DIFFERENT seat — likely one-sided seat plumbing (e.g. a seated CLI and an unseated MCP server), which drives this number down with no other tell. Seat plumbing is tracked separately in mmnto-ai/totem#2530.`,
    );
  }

  // Advisory — deliberately OUTSIDE the degraded envelope: an event type this
  // build does not know is ordinary version skew, not evidence of tampering.
  if (report.anomalies.unknownTypeRows > 0) {
    log.dim(
      TAG,
      `note: ${report.anomalies.unknownTypeRows} row(s) carry an event type this build does not know (version skew — not counted against integrity)`,
    );
  }

  // Every DERIVED line carries the qualifier, not just the headline figure.
  // The verdict line is the one that carries the pre-registered consequence —
  // rendering `verdict: PASS` unqualified beside an UNVERIFIED number is the
  // same indistinguishability the envelope exists to prevent. Trend too: it is
  // computed from the same untrusted rows.
  const unverified = report.degraded ? ' (UNVERIFIED)' : '';

  // ── The number ──
  log.info(
    TAG,
    `compliance${unverified}: ${formatQbdRate(report.window)} over ${report.evaluatedSessions} instrumented session(s)`,
  );

  // ── Pre-registration, verbatim (charter requirement) ──
  log.dim(TAG, `pre-registered threshold + window: ${QBD_PRE_REGISTRATION_STATEMENT}`);

  if (report.verdict === 'PENDING') {
    log.dim(
      TAG,
      `verdict${unverified}: PENDING — ${report.instrumentedSessions}/${QBD_PRE_REGISTERED_WINDOW_SESSIONS} instrumented sessions recorded; the threshold is not evaluable until the window fills`,
    );
  } else if (report.verdict === 'PASS') {
    log.success(
      TAG,
      `verdict${unverified}: PASS — at or above the pre-registered floor over the window`,
    );
  } else {
    log.warn(
      TAG,
      `verdict${unverified}: FAIL — below the pre-registered floor over the window. Per the #2510 pre-registration the adherence claims' Goal: prefixes are recorded as FALSIFIED for this window, and this number leads the next signoff.`,
    );
  }

  // ── Trend ──
  if (report.trend === null) {
    log.dim(TAG, `trend${unverified}: insufficient data (needs at least 4 instrumented sessions)`);
  } else {
    log.dim(
      TAG,
      `trend${unverified}: earlier ${formatQbdRate(report.trend.earlier)} → recent ${formatQbdRate(report.trend.recent)}`,
    );
  }

  // ── Honest limitation (#2510 falsifier 4) ──
  log.dim(
    TAG,
    'limitation: this senses query-before-derive ADJACENCY, not influence — a query whose results the derive never read still counts as compliant (ritual-query / Goodhart). Named, not solved.',
  );
}
