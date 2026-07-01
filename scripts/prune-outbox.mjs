#!/usr/bin/env node
/**
 * ECL outbox retention prune — the interim mechanism for
 * doctrine/ecl-discipline.md § 4.4 (mmnto-ai/totem-strategy#700), pending the
 * `totem ecl-gc` CLI subcommand that will subsume it cohort-wide.
 *
 * Deletes an agent's OWN outbox dispatches older than a retention window N
 * (default 14 days). Outbox dispatches are TRANSPORT, not archive: the durable
 * record of whatever a dispatch carried lives in its home (rulings → ADRs /
 * issues, work-state → the GH board, session history → journal/), so once a
 * dispatch ages past N the courier file is disposable. See § 4.4 for the
 * transport-not-archive principle and the safety argument.
 *
 * SINGLE-WRITER INVARIANT (ADR-106): each agent prunes only its OWN
 * `<agent-id>/outbox/` — never a peer's, never the operator's chore. This
 * script writes to exactly one path: `<root>/.totem/orchestration/<agent>/outbox/`.
 * It NEVER touches `journal/` (bounded-past record + MCP-indexed) or
 * `processed/` (the handled-state cursor — erasing it makes consumed backlog
 * re-read as unread). Scope is `outbox/` only.
 *
 * Safe by default: dry-run unless `--apply` is passed.
 *
 * Usage:
 *   node scripts/prune-outbox.mjs --agent strategy-claude              # dry-run, N=14
 *   node scripts/prune-outbox.mjs --agent strategy-claude --apply      # actually delete
 *   node scripts/prune-outbox.mjs --agent strategy-claude --days 7     # custom window
 *   node scripts/prune-outbox.mjs --agent strategy-claude --json
 *
 * --root resolution order:
 *   1. `--root <path>` (explicit override)
 *   2. Script-relative `<script-dir>/..` — the repo that hosts this script (each
 *      cohort repo carries its own copy, like poll-cohort-mail.mjs); robust
 *      against cwd drift, unlike process.cwd() (the claude-0098 class).
 *
 * Exit codes: 0 = ran clean, 1 = some deletes failed (--apply), 2 = invalid args.
 */

import { readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Default root = the repo that hosts this script (<script-dir>/..). Each cohort
// repo carries its own copy (like poll-cohort-mail.mjs), so this resolves to the
// agent's working repo robustly — process.cwd() would break under cwd drift (the
// claude-0098 cwd-misinterpretation class). --root overrides.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

// Doctrine-ratified retention window (ecl-discipline.md § 4.4). A grace window,
// not a correctness boundary — durable content already lives in homes; N only
// bounds how long the courier lingers. 14d comfortably covers infrequent-session
// (operator-run vendor) seats so a prune never clips a dispatch a slow peer
// hasn't read.
const DEFAULT_DAYS = 14;

// Same dual-form stamp acceptance as poll-cohort-mail.mjs: the cohort emits both
// YYYY-MM-DDTHHMMZ (4-digit) and YYYY-MM-DDTHHMMSSZ (6-digit, `date -u +%Y-%m-%dT%H%M%SZ`).
// Matching only one form would silently skip the other (the verify-absence trap).
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{4}(?:\d{2})?Z)/;

/**
 * Canonicalize either stamp form to a 14-digit YYYYMMDDHHMMSS key (seconds
 * default to 00) so mixed-length stamps compare correctly.
 */
function toKey(stamp) {
  const digits = stamp.replace(/\D/g, '');
  return digits.length === 12 ? digits + '00' : digits;
}

/** Return the value following a flag, or exit(2) if it is missing / another flag. */
function requireValue(name, value) {
  if (value === undefined || value.startsWith('--')) {
    process.stderr.write(`${name} requires a value\n`);
    process.exit(2);
  }
  return value;
}

/** Cutoff = now − N days, as a comparable YYYYMMDDHHMMSS key. */
function cutoffKey(days) {
  const iso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
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

/** Parse argv into { agent, days, apply, json, root }; exit(2) on invalid input. */
function parseArgs(argv) {
  const args = { agent: null, days: DEFAULT_DAYS, apply: false, json: false, root: DEFAULT_ROOT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') args.agent = requireValue('--agent', argv[++i]);
    else if (a === '--days') {
      const v = requireValue('--days', argv[++i]);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        process.stderr.write(`--days must be a non-negative integer (got: ${v})\n`);
        process.exit(2);
      }
      args.days = n;
    } else if (a === '--root') args.root = resolve(requireValue('--root', argv[++i]));
    else if (a === '--apply') args.apply = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: prune-outbox.mjs --agent <agent-id> [--days N] [--apply] [--root <path>] [--json]\n' +
          '  --agent    agent whose OWN outbox to prune (required; single-writer)\n' +
          `  --days     retention window in days (default ${DEFAULT_DAYS}; doctrine § 4.4)\n` +
          '  --apply    actually delete (default: dry-run — list only)\n' +
          '  --root     repo root (default: <script-dir>/.., the host repo)\n' +
          '  --json     emit JSON instead of a human-readable summary\n',
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  if (!args.agent) {
    process.stderr.write('--agent <agent-id> is required\n');
    process.exit(2);
  }
  // Single-writer guard (defense-in-depth on a destructive path): --agent is a
  // path segment in <root>/.totem/orchestration/<agent>/outbox. Reject anything
  // that could escape it (`..`, slashes, drive separators). Agent-ids are kebab
  // seats (strategy-claude, lc-codex) — exactly one safe segment.
  if (!/^[A-Za-z0-9_-]+$/.test(args.agent)) {
    process.stderr.write(`invalid --agent (must match ^[A-Za-z0-9_-]+$): ${args.agent}\n`);
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv);
const outbox = join(args.root, '.totem', 'orchestration', args.agent, 'outbox');
const cutoff = cutoffKey(args.days);

let kept = 0;
const pruned = [];
const skipped = []; // not a regular file, or no derivable age from filename — never touched
const failed = []; // unlink + non-ENOENT readdir errors — surfaced, drive the honest exit-1

if (existsSync(outbox)) {
  // Fail-soft read: a read failure must not throw uncaught — that would skip the
  // whole report. But stay HONEST (Tenet 4): a raced removal (ENOENT — the outbox
  // vanished between the existsSync check and the read) is benign (nothing to
  // prune → exit 0); any other failure (EACCES / permission drift) is pushed to
  // `failed` so the honest exit surfaces it with code 1 — symmetric with the
  // unlinkSync path below. Either way the report still emits (GCA, mmnto-ai/totem-strategy#794).
  let dirents = [];
  try {
    dirents = readdirSync(outbox, { withFileTypes: true });
  } catch (err) {
    process.stderr.write(`prune: failed to read outbox ${outbox}: ${err?.message ?? err}\n`);
    if (err?.code !== 'ENOENT') failed.push(`readdir:${err?.code || 'UNKNOWN'}`);
  }
  for (const dirent of dirents) {
    const f = dirent.name;
    // Only ever delete regular files. A timestamp-named subdir or other non-file
    // entry must not reach unlinkSync — it would throw mid-loop and block signoff.
    // Extension does NOT gate retention: pollMail routes by frontmatter, not
    // filename (§2.1), so a timestamped dispatch of any extension is eligible.
    // Eligibility is regular-file + derivable age; everything else is surfaced.
    if (!dirent.isFile()) {
      skipped.push(f);
      continue;
    }
    const m = f.match(TIMESTAMP_RE);
    if (!m) {
      // No age derivable from the filename. Keep it (the safe direction) and
      // surface it rather than guess an age and delete — auto-deleting an
      // un-ageable file is worse than letting it linger (mmnto-ai/totem-strategy#700 by-design).
      skipped.push(f);
      continue;
    }
    if (toKey(m[1]) >= cutoff) {
      kept++;
      continue;
    }
    if (!args.apply) {
      pruned.push(f); // dry-run: would-prune
      continue;
    }
    // Licensed fail-soft (Tenet 4): a single failed delete (EPERM, raced
    // removal) warns and continues with per-item accounting — one bad file must
    // not abort the prune or block signoff.
    try {
      unlinkSync(join(outbox, f));
      pruned.push(f);
    } catch (err) {
      failed.push(f);
      process.stderr.write(`prune: failed to delete ${f}: ${err.message}\n`);
    }
  }
}

if (args.json) {
  process.stdout.write(
    JSON.stringify(
      {
        agent: args.agent,
        outbox,
        days: args.days,
        cutoff,
        apply: args.apply,
        prunedCount: pruned.length,
        keptCount: kept,
        skippedCount: skipped.length,
        failedCount: failed.length,
        pruned,
        skipped,
        failed,
      },
      null,
      2,
    ) + '\n',
  );
} else if (!existsSync(outbox)) {
  process.stdout.write(`outbox not found (nothing to prune): ${outbox}\n`);
} else {
  const verb = args.apply ? 'Pruned' : 'Would prune';
  process.stdout.write(
    `# ECL outbox prune — ${args.agent} — retention ${args.days}d (cutoff < ${cutoff})\n` +
      `${verb} ${pruned.length} dispatch(es); kept ${kept}` +
      (skipped.length ? `; skipped ${skipped.length} non-dispatch` : '') +
      (failed.length ? `; FAILED ${failed.length} (see stderr)` : '') +
      `\n`,
  );
  if (!args.apply && pruned.length) {
    process.stdout.write('  (dry-run — re-run with --apply to delete)\n');
  }
}

// Honest exit: a non-zero code on failed deletes lets a caller detect a partial
// prune (read-only mount, permission drift). /signoff consumes this as a sensor,
// not a gate (Tenet 13 / E2) — it reports the failed count and continues the seal.
process.exit(failed.length ? 1 : 0);
