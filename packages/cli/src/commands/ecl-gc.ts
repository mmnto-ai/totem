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
 * Safe by default: dry-run (list only) unless `--apply` is passed. This train
 * ships PRUNE ONLY — processed-mark compaction is a deferred follow-on and is
 * deliberately NOT built here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getErrorMessage, isPathSafeAgentId, TotemError } from '@mmnto/totem';

import { resolveSelfSender } from './mail.js';

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
  /** Emit the structured result as JSON to stdout instead of human text. */
  json?: boolean;
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
    log.error(TAG, `FAILED ${result.failed.length} delete(s) — surfaced, non-blocking:`);
    for (const f of result.failed) {
      log.error(TAG, `  - ${f.file}: ${f.error}`);
    }
  }
  for (const w of result.warnings) {
    log.warn(TAG, w);
  }
  return result;
}
