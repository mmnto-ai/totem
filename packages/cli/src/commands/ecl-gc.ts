/**
 * `totem ecl-gc` — ECL outbox retention prune (mmnto-ai/totem#2279; parent
 * mmnto-ai/totem-strategy#700 / doctrine/ecl-discipline.md § 4.4).
 *
 * The binary-guaranteed cohort-wide replacement for the interim
 * `scripts/prune-outbox.mjs`: it deletes an agent's OWN outbox dispatches once
 * they age past the retention window N (default 14 days). Outbox dispatches are
 * TRANSPORT, not archive — the durable record of whatever a dispatch carried
 * lives in its home (rulings → ADRs / issues, work-state → the GH board,
 * session history → `journal/`), so an aged courier file is disposable.
 *
 * SINGLE-WRITER INVARIANT (ADR-106): each agent prunes only its OWN
 * `<repoRoot>/.totem/orchestration/<agent-id>/outbox/` — never a peer's, never
 * the operator's chore. Self-resolution (Tenet-21 reuse of `resolveSelfSender`)
 * makes pruning a peer structurally unreachable: the target path is composed
 * from the resolved single agent-id and nothing else. This command NEVER reads
 * or touches `journal/` (bounded-past record + MCP-indexed) or `processed/`
 * (the handled-state cursor — erasing it makes consumed backlog re-read as
 * unread) or any inbox / other seat. Scope is `outbox/` only.
 *
 * Safe by default: dry-run (list only) unless `--apply` is passed.
 *
 * COMPACTION (mmnto-ai/totem#2307; contract ADR-106 § A2 + ecl-discipline § 4.5,
 * ratified strategy#826). `eclCompact` is the cursor-coupled processed-mark GC
 * sibling of the prune above: it deletes an agent's OWN `processed/` marks that
 * shadow nothing — a mark whose inbound dispatch its sender already swept per
 * § 4.4. The retained cursor is `processed ∩ raw-addressed-inbound` (A2.1: the
 * PRE-dedupe scan, never `pollMail`'s `inbound − processed` list). Deletion is
 * licensed ONLY against a provably-complete poll (A2.2: full expected roster
 * present, zero warnings, not truncated — else zero deletes), binds to exactly
 * one seat (A2.3), and self-verifies via an immediate re-poll (A2.4). Unlike the
 * prune's age window, compaction couples to the outbox lifecycle, not to time.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { cohortRepos, getErrorMessage, isPathSafeAgentId, TotemError } from '@mmnto/totem';

import { pollMail, resolveSelfSender } from './mail.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'EclGc';

/**
 * Doctrine-ratified retention window (ecl-discipline.md § 4.4). A grace window,
 * not a correctness boundary — durable content already lives in homes; N only
 * bounds how long the courier lingers. 14d comfortably covers infrequent-
 * session (operator-run vendor) seats so a prune never clips a dispatch a slow
 * peer hasn't read.
 */
const DEFAULT_RETAIN_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Dual-form stamp acceptance ported verbatim from `scripts/prune-outbox.mjs`:
 * the cohort emits both `YYYY-MM-DDTHHMMZ` (4-digit) and `YYYY-MM-DDTHHMMSSZ`
 * (6-digit, `date -u +%Y-%m-%dT%H%M%SZ`). Matching only one form would silently
 * skip the other (the verify-absence trap).
 */
const STAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{4}(?:\d{2})?Z)/;

// ─── Types ──────────────────────────────────────────────

export interface EclGcOptions {
  /** Actually delete (default: dry-run — list would-prune, delete nothing). */
  apply?: boolean;
  /** Retention window in days (default 14). Must be a non-negative integer. */
  retainDays?: number;
  /**
   * Override the self-resolved agent-id (visiting / orchestrator case only).
   * NOT used by the signoff step — that path self-resolves.
   */
  agentId?: string;
  /** Repo root override (default: `process.cwd()`). Test injection point. */
  repoRoot?: string;
  /** Env override (default: `process.env`). Test injection point. */
  env?: Record<string, string | undefined>;
  /** Clock injection for deterministic cutoffs in tests (default: `new Date()`). */
  now?: () => Date;
}

/**
 * Structured prune result. Also the `--json` payload. `pruned` lists the files
 * actually removed under `--apply` (or the would-prune set in dry-run);
 * `failed` captures per-file delete failures (never fatal); `skipped` surfaces
 * every entry left untouched together with WHY (non-file, non-`.md`,
 * unparseable stamp).
 */
export interface EclGcResult {
  agent: string;
  retainDays: number;
  dryRun: boolean;
  outbox: string;
  cutoffKey: string;
  pruned: string[];
  // eslint-disable-next-line id-match -- 'error' is the JSON result field name here (the `--json` payload contract), not a catch binding (mmnto-ai/totem#2279)
  failed: { file: string; error: string }[];
  kept: number;
  skipped: { file: string; reason: string }[];
  warnings: string[];
}

// ─── Pure helpers ───────────────────────────────────────

/**
 * Canonicalize either stamp form to a 14-digit `YYYYMMDDHHMMSS` key (seconds
 * default to `00`) so mixed-length stamps compare correctly. Ported from
 * `scripts/prune-outbox.mjs:toKey`.
 */
export function toStampKey(stamp: string): string {
  const digits = stamp.replace(/\D/g, '');
  return digits.length === 12 ? `${digits}00` : digits;
}

/**
 * Cutoff = `now − retainDays`, as a comparable 14-digit `YYYYMMDDHHMMSS` key.
 * Derives from the injected `now` for determinism (Tenet 15). Ported from
 * `scripts/prune-outbox.mjs:cutoffKey`.
 */
export function cutoffKey(now: Date, retainDays: number): string {
  const iso = new Date(now.getTime() - retainDays * MS_PER_DAY).toISOString();
  // iso = 2026-06-16T22:13:32.088Z -> 20260616221332
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19)
  );
}

/** A directory entry reduced to the classification inputs (pure-helper seam). */
export interface DirEntryLike {
  name: string;
  isFile: boolean;
}

/** The per-entry verdict a classifier returns. */
export type PruneClass =
  | { action: 'prune' }
  | { action: 'keep' }
  | { action: 'skip'; reason: string };

/**
 * Classify a single directory entry against the cutoff. Safe-direction bias:
 * anything whose age is not derivable from an eligible filename is KEPT +
 * surfaced, never deleted (auto-deleting an un-ageable file is worse than
 * letting it linger — mmnto-ai/totem-strategy#700 by-design). Non-file entries
 * are checked FIRST so a directory named `*.md` can never reach a delete.
 */
export function classifyEntry(entry: DirEntryLike, cutoff: string): PruneClass {
  if (!entry.isFile) {
    return { action: 'skip', reason: 'not a regular file' };
  }
  // Extension gate (spec-narrowed vs the port): only `.md` dispatches are
  // prune-eligible; a `.tmp` / `.gitkeep` / other stray is surfaced, never
  // deleted.
  if (!entry.name.endsWith('.md')) {
    return { action: 'skip', reason: 'not a .md dispatch' };
  }
  const m = STAMP_RE.exec(entry.name);
  if (m === null) {
    return { action: 'skip', reason: 'unparseable stamp' };
  }
  // Exact boundary is RETAINED: `< cutoff` prunes, `>= cutoff` keeps.
  return toStampKey(m[1]!) < cutoff ? { action: 'prune' } : { action: 'keep' };
}

/** The classification plan for a whole directory listing. */
export interface PrunePlan {
  prune: string[];
  kept: number;
  skipped: { file: string; reason: string }[];
}

/**
 * Pure prune-plan classification: given a directory listing + a cutoff key,
 * partition entries into prune / keep / skip. Deterministic order (filename
 * sort) so the reported lists are stable across platforms.
 */
export function planPrune(entries: DirEntryLike[], cutoff: string): PrunePlan {
  const prune: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  let kept = 0;
  const ordered = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of ordered) {
    const verdict = classifyEntry(entry, cutoff);
    if (verdict.action === 'prune') {
      prune.push(entry.name);
    } else if (verdict.action === 'keep') {
      kept += 1;
    } else {
      skipped.push({ file: entry.name, reason: verdict.reason });
    }
  }
  return { prune, kept, skipped };
}

// ─── Core prune ─────────────────────────────────────────

/**
 * Programmatic entry point. Resolves the single self-agent, validates inputs,
 * scans that agent's OWN outbox, and (under `--apply`) deletes the aged
 * dispatches. Returns a structured `EclGcResult`.
 *
 * Throws ONLY on usage errors (unresolvable/ambiguous self, unsafe agent-id,
 * invalid `--retain-days`), and always BEFORE any directory scan or deletion.
 * Filesystem failures are NEVER thrown — a per-file delete failure is captured
 * into `result.failed` (janitorial sensor, not a gate — Tenet 13).
 */
export function eclGc(opts: EclGcOptions = {}): EclGcResult {
  const env = opts.env ?? process.env;
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const now = (opts.now ?? (() => new Date()))();

  // Retain-days validation (usage error) — evaluated before any scan.
  const retainDays = opts.retainDays ?? DEFAULT_RETAIN_DAYS;
  if (!Number.isInteger(retainDays) || retainDays < 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      `--retain-days must be a non-negative integer (got: ${String(retainDays)})`,
      'pass --retain-days <n> with a whole number of days ≥ 0.',
    );
  }

  // Self-resolution (Tenet-21 reuse — panel-mandated). `resolveSelfSender`
  // picks the single writer (explicit > unambiguous self > throw). Its native
  // message talks about "outbound dispatch"; rewrap into a prune-shaped usage
  // error. Resolution + validation happen BEFORE any directory scan/deletion.
  let agent: string;
  try {
    agent = resolveSelfSender(repoRoot, env, opts.agentId);
  } catch (err) {
    throw new TotemError(
      'CONFIG_INVALID',
      `cannot resolve a single agent whose outbox to prune: ${getErrorMessage(err)}`,
      'set TOTEM_SELF_AGENT or pass --agent-id <agent-id>.',
      err,
    );
  }
  // Defense-in-depth on a destructive path: the resolved id is a path segment
  // in `.totem/orchestration/<agent>/outbox`. Reject anything that could escape
  // it (traversal, separators, control/whitespace/win32-reserved chars).
  if (!isPathSafeAgentId(agent)) {
    throw new TotemError(
      'CONFIG_INVALID',
      `invalid agent-id ${JSON.stringify(agent)} (path traversal, unsafe characters, or empty)`,
      'pass a plain agent-id such as "totem-claude" (no path separators, "..", whitespace, or control characters).',
    );
  }

  const dryRun = opts.apply !== true;
  const outbox = path.join(repoRoot, '.totem', 'orchestration', agent, 'outbox');
  const cutoff = cutoffKey(now, retainDays);
  const warnings: string[] = [];

  const result: EclGcResult = {
    agent,
    retainDays,
    dryRun,
    outbox,
    cutoffKey: cutoff,
    pruned: [],
    failed: [],
    kept: 0,
    skipped: [],
    warnings,
  };

  // Missing outbox is the routine "nothing to prune" signal — clean empty
  // result, never an error (the seat simply hasn't sent mail from this repo).
  if (!fs.existsSync(outbox)) {
    return result;
  }

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(outbox, { withFileTypes: true });
    // totem-context: intentional cleanup — an unreadable outbox (EACCES, raced removal) is surfaced as a warning and degrades to an empty prune rather than throwing; the prune is a janitorial sensor, not a gate (Tenet 13).
  } catch (err) {
    warnings.push(`outbox read failed (${outbox}): ${getErrorMessage(err)}`);
    return result;
  }

  const plan = planPrune(
    dirents.map((d) => ({ name: d.name, isFile: d.isFile() })),
    cutoff,
  );
  result.kept = plan.kept;
  result.skipped = plan.skipped;

  // Dry-run: report the would-prune set, delete nothing.
  if (dryRun) {
    result.pruned = plan.prune;
    return result;
  }

  // Apply: unlink each aged dispatch. A single failed delete (EPERM, raced
  // removal) is captured with per-item accounting and the loop continues —
  // one bad file must never abort the prune (fail-soft, Tenet 4).
  for (const file of plan.prune) {
    try {
      fs.unlinkSync(path.join(outbox, file));
      result.pruned.push(file);
      // totem-context: intentional cleanup — a per-file unlink failure is captured into result.failed and the loop continues; the wrapper turns a non-empty failed[] into exit 1 (partial-prune sensor), never a throw.
    } catch (err) {
      result.failed.push({ file, error: getErrorMessage(err) });
    }
  }
  return result;
}

// ─── CLI wrapper ────────────────────────────────────────

/**
 * Render an `EclGcResult`. With `json`, the structured result goes to stdout
 * (hook-friendly clean stream). Otherwise a human summary goes to stderr via
 * the standard CLI logger (agent, mode, pruned/kept counts, skipped-with-
 * reasons, failed count) — mirrors `mail.ts`'s stderr `log` usage.
 */
export async function eclGcCommand(result: EclGcResult, json: boolean): Promise<EclGcResult> {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  const { log } = await import('../ui.js');
  const mode = result.dryRun ? 'dry-run (list only — re-run with --apply to delete)' : 'apply';
  const verb = result.dryRun ? 'would prune' : 'pruned';
  log.info(
    TAG,
    `agent: ${result.agent} · retention ${result.retainDays}d · cutoff < ${result.cutoffKey}`,
  );
  log.info(TAG, `mode: ${mode}`);
  log.info(TAG, `${verb} ${result.pruned.length}; kept ${result.kept}`);
  if (result.skipped.length > 0) {
    log.warn(TAG, `skipped ${result.skipped.length} non-dispatch entr(y/ies) — left untouched:`);
    for (const s of result.skipped) {
      log.warn(TAG, `  - ${s.file}: ${s.reason}`);
    }
  }
  if (result.failed.length > 0) {
    log.error('Totem Error', `FAILED ${result.failed.length} delete(s) — surfaced, non-blocking:`);
    for (const f of result.failed) {
      log.error('Totem Error', `  - ${f.file}: ${f.error}`);
    }
  }
  for (const w of result.warnings) {
    log.warn(TAG, w);
  }
  return result;
}

// ─── Compaction (ADR-106 § A2 / ecl-discipline § 4.5) ───

const COMPACT_TAG = 'EclGc:compact';

/** Local directory predicate (stat-based) — a repo/orch dir must be a real
 * directory, not merely an existing path (a same-named file must not pass the
 * A2.2 roster-presence check). Mirrors the resolver's private `isDirectory`. */
function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
    // totem-context: intentional fall-through — a stat failure (ENOENT, EACCES) is the "repo absent" signal the A2.2 roster gate consumes; rethrowing would force the gate to wrap a routine outcome.
  } catch {
    return false;
  }
}

/** Read the `.md` mark basenames in a `processed/` (sub)dir. A missing dir is
 * the routine "no marks here" signal (empty). A read FAILURE is a stop
 * condition for the A2.2 gate — pushed to `warnings` so the gate goes red
 * (an un-enumerable own cursor cannot be safely compacted). */
function readMarkDir(dir: string, warnings: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    // totem-context: intentional cleanup — a processed/ read failure (EACCES, raced rename) becomes a gate-reddening warning, never a throw; the compaction degrades to zero deletes (retain), the safe direction (A2.2).
  } catch (err) {
    warnings.push(`processed/ scan failed (${dir}): ${getErrorMessage(err)}`);
    return [];
  }
}

export interface EclCompactOptions {
  /** Actually delete inert marks (default: dry-run — list would-collect only). */
  apply?: boolean;
  /**
   * Override the self-resolved agent-id (visiting/orchestrator case). The
   * single-writer compaction target; NOT used by the signoff step (self-resolves).
   */
  agentId?: string;
  /** Repo root override (default: `process.cwd()`). Test injection point. */
  repoRoot?: string;
  /** Env override (default: `process.env`). Test injection point. */
  env?: Record<string, string | undefined>;
  /** Workspace override (default: `TOTEM_WORKSPACE` env, else parent of repoRoot). */
  workspace?: string;
  /** Scan cap override (default: mail's `MAX_SCAN`). Injection point for the
   * A2.2 truncation abort arm — exercised with small fixtures. */
  maxScan?: number;
  /**
   * Declared expected cohort repo roster for the A2.2 completeness gate
   * (default: `cohortRepos()`). Tests inject an explicit roster; the default is
   * the map-derived set pending the strategy#611-vs-map ruling (mmnto-ai/totem#2307).
   */
  expectedRepos?: string[];
}

/**
 * Structured compaction result. Also the `--json` payload. `collectable` is the
 * would-collect set in dry-run (or the eligible set pre-delete under apply);
 * `collected` is what actually got deleted (gate-green only); `resurfaced` is
 * the A2.4 falsifier output — MUST be empty (a non-empty set means a live mark
 * was collected and the completeness gate was too weak).
 */
export interface EclCompactResult {
  agent: string;
  dryRun: boolean;
  workspace: string;
  expectedRepos: string[];
  /** A2.2 gate: true iff full roster present AND zero scan warnings AND not truncated. */
  gateComplete: boolean;
  /** Why the gate is red (missing repos, scan/read/parse warnings, truncation); empty iff complete. */
  gateReasons: string[];
  /** Count of raw addressed-inbound basenames discovered (pre-dedupe; to:S ∪ broadcast). */
  rawInbound: number;
  /** Total own processed marks examined (direct ∪ broadcast). */
  marks: number;
  /** Marks whose dispatch is absent from raw inbound — the would-collect set (dry-run / pre-delete). */
  collectable: string[];
  /** Marks actually deleted (⊆ collectable; gate-green apply only). */
  collected: string[];
  /** Marks left in place after the run. */
  retained: number;
  // eslint-disable-next-line id-match -- 'error' is the JSON result field name here (the `--json` payload contract), not a catch binding (mmnto-ai/totem#2307)
  failed: { file: string; error: string }[];
  /** A2.4 falsifier: previously-handled dispatches that re-surfaced as unread post-compact (MUST be []). */
  resurfaced: string[];
  warnings: string[];
}

/**
 * Programmatic entry point for cursor-coupled processed-mark compaction. For a
 * single resolved seat, deletes `processed/` marks whose inbound dispatch is
 * absent from the RAW addressed-inbound set (A2.1) — but ONLY when discovery is
 * provably complete (A2.2), and then self-verifies (A2.4).
 *
 * Throws ONLY on usage errors (unresolvable/ambiguous self, unsafe agent-id),
 * always BEFORE any scan or deletion (exit-2 class, parity with `eclGc`). Every
 * safety failure (incomplete roster, scan warning, truncation) is a STRUCTURED
 * gate-red result with zero deletes, never a throw — the caller maps it to the
 * compaction-abort exit code.
 */
export function eclCompact(opts: EclCompactOptions = {}): EclCompactResult {
  const env = opts.env ?? process.env;
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const workspace = path.resolve(
    opts.workspace ?? env['TOTEM_WORKSPACE'] ?? path.dirname(repoRoot),
  );
  const expectedRepos = [...(opts.expectedRepos ?? cohortRepos())].sort();

  // Single-writer target (A2.3): resolve EXACTLY one seat. Ambiguous/zero self
  // is a usage error (parity with `eclGc`), thrown before any scan or delete.
  let agent: string;
  try {
    agent = resolveSelfSender(repoRoot, env, opts.agentId);
  } catch (err) {
    throw new TotemError(
      'CONFIG_INVALID',
      `cannot resolve a single agent whose processed cursor to compact: ${getErrorMessage(err)}`,
      'set TOTEM_SELF_AGENT or pass --agent-id <agent-id>.',
      err,
    );
  }
  if (!isPathSafeAgentId(agent)) {
    throw new TotemError(
      'CONFIG_INVALID',
      `invalid agent-id ${JSON.stringify(agent)} (path traversal, unsafe characters, or empty)`,
      'pass a plain agent-id such as "totem-claude" (no path separators, "..", whitespace, or control characters).',
    );
  }

  const dryRun = opts.apply !== true;
  const warnings: string[] = [];

  // A2.2 gate part 1 — full expected repo roster present. A silently-absent
  // cohort repo is the false-unread leak (a live mark in its unscanned outbox
  // looks inert): N < M is a hard block, never a silent skip (Tenet 4).
  const missingRepos = expectedRepos.filter((repo) => !isDir(path.join(workspace, repo)));

  // A2.1 — raw addressed-inbound: the SAME mail scan the reader runs, halted at
  // the pre-dedupe stage (`includeProcessed`), bound to EXACTLY this seat via a
  // forced `TOTEM_SELF_AGENT` so the multi-seat coordinator union never leaks in
  // (A2.3). `pollMail` never throws — fs failures land in `poll.warnings`.
  const poll = pollMail({
    repoRoot,
    workspace,
    maxScan: opts.maxScan,
    includeProcessed: true,
    env: { ...env, TOTEM_SELF_AGENT: agent },
  });
  warnings.push(...poll.warnings);
  const rawBasenames = new Set(poll.mail.map((m) => m.file));

  // Own processed marks (single-writer: this seat's OWN cursor only, in this
  // repo). `processed/` (direct) ∪ `processed/_broadcast/` (broadcast).
  const processedBase = path.join(repoRoot, '.totem', 'orchestration', agent, 'processed');
  const broadcastDir = path.join(processedBase, '_broadcast');
  const directMarks = readMarkDir(processedBase, warnings);
  const broadcastMarks = readMarkDir(broadcastDir, warnings);
  const directSet = new Set(directMarks);
  const broadcastSet = new Set(broadcastMarks);
  const allMarks = new Set([...directMarks, ...broadcastMarks]);

  const gateComplete = missingRepos.length === 0 && warnings.length === 0 && !poll.truncated;
  const gateReasons = [
    ...missingRepos.map((r) => `expected cohort repo missing from workspace: ${r}`),
    ...warnings,
    ...(poll.truncated ? [`scan truncated at ${poll.scanned} files (MAX_SCAN)`] : []),
  ];

  // Collectable = own marks whose dispatch is ABSENT from raw addressed-inbound.
  // The raw set is the union of to:S ∪ broadcast (this seat forced; broadcast
  // always matches), which mirrors `pollMail`'s recipient-class-blind basename
  // filter — so a mark in EITHER store shadows a live dispatch of that basename;
  // union retention is the sound match (codex panel). Deterministic order.
  const collectable = [...allMarks].filter((m) => !rawBasenames.has(m)).sort();

  const result: EclCompactResult = {
    agent,
    dryRun,
    workspace,
    expectedRepos,
    gateComplete,
    gateReasons,
    rawInbound: rawBasenames.size,
    marks: allMarks.size,
    collectable,
    collected: [],
    retained: allMarks.size,
    failed: [],
    resurfaced: [],
    warnings,
  };

  // Never delete in dry-run OR when the gate is red. A collectable set computed
  // from an INCOMPLETE poll is unreliable by construction (the A2.2 point), so a
  // gate-red run does not even surface it as would-collect (uncertain ⇒ retain).
  if (dryRun || !gateComplete) {
    if (!gateComplete) result.collectable = [];
    return result;
  }

  // Apply + gate green: delete each inert mark from whichever store holds it. A
  // per-file unlink failure leaves a lingering INERT mark (bounded storage,
  // safe) — captured with per-item accounting, non-fatal (janitorial exit-1
  // class), never a throw.
  for (const name of collectable) {
    let deletedAny = false;
    if (directSet.has(name)) {
      try {
        fs.unlinkSync(path.join(processedBase, name));
        deletedAny = true;
        // totem-context: intentional cleanup — a per-mark unlink failure is captured into result.failed and the loop continues; the wrapper maps a non-empty failed[] to the janitorial exit code, never a throw.
      } catch (err) {
        result.failed.push({ file: name, error: getErrorMessage(err) });
      }
    }
    if (broadcastSet.has(name)) {
      try {
        fs.unlinkSync(path.join(broadcastDir, name));
        deletedAny = true;
        // totem-context: intentional cleanup — see the direct-store unlink above; dual placement so the rule fires on either catch line.
      } catch (err) {
        result.failed.push({ file: `_broadcast/${name}`, error: getErrorMessage(err) });
      }
    }
    if (deletedAny) result.collected.push(name);
  }
  result.retained = allMarks.size - result.collected.length;

  // A2.4 falsifier (in-command): immediately re-poll the SAME seat and assert NO
  // previously-handled dispatch re-surfaces as unread. A resurfaced basename ∈
  // the pre-compaction mark set means a LIVE mark was collected — the gate was
  // too weak; the caller maps a non-empty `resurfaced` to the abort exit code.
  const verify = pollMail({ repoRoot, workspace, env: { ...env, TOTEM_SELF_AGENT: agent } });
  result.resurfaced = verify.mail
    .map((m) => m.file)
    .filter((f) => allMarks.has(f))
    .sort();

  return result;
}

/**
 * Render an `EclCompactResult`. `--json` → structured stdout; otherwise a human
 * summary to stderr. A red gate reports the reasons + zero deletes; a tripped
 * A2.4 falsifier and per-mark delete failures are surfaced via the error logger.
 */
export async function eclCompactCommand(
  result: EclCompactResult,
  json: boolean,
): Promise<EclCompactResult> {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  const { log } = await import('../ui.js');
  const mode = result.dryRun ? 'dry-run (list only — re-run with --apply to delete)' : 'apply';
  log.info(
    COMPACT_TAG,
    `agent: ${result.agent} · roster ${result.expectedRepos.length} repo(s) · mode: ${mode}`,
  );
  if (!result.gateComplete) {
    log.warn(
      COMPACT_TAG,
      `A2.2 completeness gate NOT met — retained all ${result.marks} mark(s), deleted 0:`,
    );
    for (const r of result.gateReasons) log.warn(COMPACT_TAG, `  - ${r}`);
    return result;
  }
  const verb = result.dryRun ? 'would collect' : 'collected';
  const collectN = result.dryRun ? result.collectable.length : result.collected.length;
  const retainedN = result.dryRun ? result.marks - result.collectable.length : result.retained;
  log.info(
    COMPACT_TAG,
    `${verb} ${collectN} inert mark(s); retained ${retainedN} of ${result.marks}; raw addressed-inbound ${result.rawInbound}`,
  );
  if (result.failed.length > 0) {
    log.error(
      'Totem Error',
      `FAILED ${result.failed.length} mark delete(s) — surfaced, non-blocking:`,
    );
    for (const f of result.failed) log.error('Totem Error', `  - ${f.file}: ${f.error}`);
  }
  if (result.resurfaced.length > 0) {
    log.error(
      'Totem Error',
      `A2.4 FALSIFIER TRIPPED — ${result.resurfaced.length} handled dispatch(es) re-surfaced as unread (a live mark was collected):`,
    );
    for (const f of result.resurfaced) log.error('Totem Error', `  - ${f}`);
  }
  for (const w of result.warnings) log.warn(COMPACT_TAG, w);
  return result;
}

/**
 * Combined prune+compact exit-code contract (codex panel, mmnto-ai/totem#2307).
 * Pure so the precedence is unit-testable independent of the CLI wrapper. The
 * usage code `2` is NOT modeled here — it is the thrown-error path the wrapper
 * catches around this call. Precedence: `3` (compaction abort — A2.2 gate red or
 * A2.4 falsifier tripped) outranks `1` (partial janitorial delete failure, from
 * either phase), which outranks `0` (clean). So a prune-partial + compact-abort
 * is `3`, with the prune count still carried in the structured result.
 */
export function resolveEclGcExitCode(
  prune: Pick<EclGcResult, 'failed'>,
  compact?: Pick<EclCompactResult, 'gateComplete' | 'resurfaced' | 'failed'>,
): 0 | 1 | 3 {
  if (compact !== undefined && (!compact.gateComplete || compact.resurfaced.length > 0)) {
    return 3;
  }
  if (prune.failed.length > 0 || (compact?.failed.length ?? 0) > 0) {
    return 1;
  }
  return 0;
}
