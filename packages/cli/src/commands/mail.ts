/**
 * `totem mail` — canonical cross-repo outbox poll (ADR-106 § 3 / ADR-107).
 *
 * Senders write to their own `<repoRoot>/.totem/orchestration/<sender-agent>/outbox/*.md`
 * with `to: <recipient-agent>` (or `to: broadcast`) in the frontmatter.
 * Recipients invoke this command at session-start (typically via a
 * vendor-specific hook in `.claude/hooks/` or `.gemini/hooks/`) to surface
 * unread mail addressed to themselves.
 *
 * SELF_AGENTS resolution flows through `resolveSelfAgents` from
 * `@mmnto/totem` (env > config.json > basename map). Workspace defaults to
 * the parent directory of the calling repo, overridable via the
 * `TOTEM_WORKSPACE` env var or `--workspace` flag.
 *
 * Ports the strategy-side reference implementation
 * (`mmnto-ai/totem-strategy:.claude/hooks/SessionStart.cjs:pollInboundOutboxes`,
 * merged via mmnto-ai/totem-strategy#373) into a cohort-portable command
 * surface per the ADR-107 § Consequences direction.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isPathSafeAgentId, knownCohortAgents, resolveSelfAgents, TotemError } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Mail';

/**
 * Hard cap on filesystem entries scanned per invocation. Matches the
 * strategy reference impl's MAX_SCAN; balances thoroughness against hook
 * latency. When tripped, the result carries `truncated: true` so the
 * caller can surface the warning instead of silently dropping mail.
 */
const MAX_SCAN = 500;

// ─── Types ──────────────────────────────────────────────

/** A single piece of mail surfaced by the poll. */
export interface MailEntry {
  /** Outbox-relative filename (e.g. `2026-05-18T1734Z-strategy-claude.md`). */
  file: string;
  /** Repo basename where the outbox lives. */
  repo: string;
  /** Sender agent-id (from frontmatter `from:` or outbox-dir name as fallback). */
  from: string;
  /** Recipient (from frontmatter `to:`, preserved verbatim). */
  to: string;
  /** ISO timestamp from frontmatter `timestamp:` (ADR-098 v0.4 canonical), falling back to legacy `date:`; null if absent. */
  date: string | null;
  /** Subject line from frontmatter, or `(no subject)` if absent. */
  subject: string;
  /** Absolute path to the outbox file (useful for `--json` consumers). */
  filePath: string;
}

/** Aggregate result of a single poll. */
export interface MailPollResult {
  /** Resolution metadata describing how SELF_AGENTS was determined. */
  selfAgents: {
    agents: string[];
    source: 'env' | 'config' | 'map' | 'none';
  };
  /** Mail addressed to any SELF_AGENT or to `broadcast`, sorted newest-first. */
  mail: MailEntry[];
  /** Total files actually opened during the scan (≤ `MAX_SCAN`). */
  scanned: number;
  /** True iff the scan hit `MAX_SCAN` before exhausting the workspace. */
  truncated: boolean;
  /** Workspace directory walked (absolute). */
  workspace: string;
  /** Per-source repo failure messages — never throws, surfaces via this. */
  warnings: string[];
}

export interface MailCommandOptions {
  /** Emit JSON instead of human-readable text. */
  json?: boolean;
  /** Use the recursive variant of the ADR-106 § 3 glob (default: single-level). */
  recursive?: boolean;
  /** Workspace override (default: `TOTEM_WORKSPACE` env, else parent-of-cwd). */
  workspace?: string;
  /** Repo root override (default: `process.cwd()`). Test injection point. */
  repoRoot?: string;
  /** Env override (default: `process.env`). Test injection point. */
  env?: Record<string, string | undefined>;
}

// ─── Frontmatter parsing ────────────────────────────────

/**
 * Hard cap on bytes searched for the CLOSING `---` frontmatter delimiter.
 * Bounds regex work on pathological files. Genuine cohort frontmatter is
 * multi-KiB — frontmatter-only dispatches carry the whole message in
 * `subject:` (4,163 bytes observed live, mmnto-ai/totem#2118) — so the
 * window is sized ~4× the observed max, NOT the "dozens of bytes" the
 * 2 KiB predecessor assumed (that assumption silently dropped 8/8 of the
 * misses in the #2118 forensics). A closing `---` beyond this window is
 * treated as absent.
 */
const MAX_HEADER_SEARCH_BYTES = 16_384;

/**
 * Closing frontmatter delimiter: a `---` line after the opener (LF/CRLF/EOF),
 * tolerating trailing whitespace on the line (hand-authored dispatches).
 */
const CLOSING_DELIMITER = /\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Discriminated parse result so the scan loop can warn on mail-shaped
 * rejects (sender error — must be loud, Tenet 4) while staying silent on
 * stray non-mail files (a warning there would be permanent, unclearable
 * noise: the recipient cannot remove a sender's file). Carries the reject
 * reason for the warning message. mmnto-ai/totem#2118: parse-null was the
 * module's only warning-less failure path, and it ate real dispatches.
 */
type HeaderParse =
  | {
      ok: true;
      header: { to: string; from: string | null; subject: string | null; date: string | null };
    }
  | { ok: false; mailShaped: boolean; reason: string };

/**
 * Extract `to:` / `from:` / `subject:` / `date:` from a leading frontmatter
 * block. Restricts the regex search to the delimited header (text between
 * the opening and closing `---` lines) so body lines starting with `to:`
 * etc. cannot fabricate a match or overwrite displayed metadata.
 *
 * `to:` is the only frontmatter field required for a file to be eligible
 * mail; a mail-shaped file without it is a reject, not a fallback.
 */
function parseHeader(content: string): HeaderParse {
  // Defense in depth: real handoffs open with a YAML frontmatter delimiter.
  // Reject anything that doesn't, so a stray .md file in an outbox cannot
  // be coerced into mail.
  if (!content.startsWith('---')) {
    return { ok: false, mailShaped: false, reason: 'no opening --- delimiter' };
  }

  // Parse to the CLOSING `---` line (mmnto-ai/totem#2118). The predecessor
  // split on the first blank line and rejected any >2 KiB file without one —
  // silently dropping every frontmatter-only dispatch over 2 KiB (the cohort
  // convention puts the whole message in `subject:`, zero blank lines). The
  // closing delimiter is the real header terminator; the byte cap bounds the
  // SEARCH WINDOW instead of rejecting the file outright.
  const window = content.slice(3, 3 + MAX_HEADER_SEARCH_BYTES);
  const close = CLOSING_DELIMITER.exec(window);
  if (!close) {
    return {
      ok: false,
      mailShaped: true,
      reason:
        // The window starts at byte 3 (after the opener), so truncation only
        // actually occurs past 3 + MAX — the window message must not fire for
        // files the window fully covered (Greptile R1 on mmnto-ai/totem#2119).
        content.length > 3 + MAX_HEADER_SEARCH_BYTES
          ? `no closing --- within the ${MAX_HEADER_SEARCH_BYTES}-byte search window`
          : 'no closing --- delimiter',
    };
  }
  const header = window.slice(0, close.index);

  const toMatch = header.match(/^to:\s*(.+)$/im);
  if (!toMatch) {
    return { ok: false, mailShaped: true, reason: 'no to: field in frontmatter' };
  }
  const fromMatch = header.match(/^from:\s*(.+)$/im);
  const subjectMatch = header.match(/^[-\s]*subject:\s*(.+)$/im);
  const subject = subjectMatch ? unquoteScalar(subjectMatch[1]!.trim()) : null;
  // ADR-098 v0.4 codified `timestamp:` (full RFC3339) as canonical, replacing
  // legacy `date:`; `date:` remains a backwards-compat read (the amendment's
  // own migration note). Read `timestamp:` first, fall back to `date:`. The
  // surfaced field stays `MailEntry.date` (no rename) — it is the displayed
  // time, and a cosmetic rename would widen blast radius across hooks +
  // `--json` consumers for no contract gain (Tenet 5; strategy-claude concur
  // 2026-06-09, folded into ADR-098's migration note on the strategy side).
  const timestampMatch = header.match(/^timestamp:\s*(.+)$/im);
  const dateMatch = header.match(/^date:\s*(.+)$/im);
  const when = timestampMatch ? timestampMatch[1]! : dateMatch ? dateMatch[1]! : null;
  // Every field below is sender-controlled wire text that downstream writers
  // (`formatTextResult` → stderr, `--json` consumers' logs) display verbatim —
  // escape raw control bytes at this single boundary so no parse path (quoted,
  // unquoted, hand-authored) can carry terminal-injection bytes into
  // `MailEntry` (CR R5 on mmnto-ai/totem#2134; the unquoted exposure predates
  // this PR — closing the whole class here, not just the unquote fallback).
  return {
    ok: true,
    header: {
      to: escapeControlBytes(toMatch[1]!.trim()),
      from: fromMatch ? escapeControlBytes(fromMatch[1]!.trim()) : null,
      subject: subject !== null ? escapeControlBytes(subject) : null,
      date: when !== null ? escapeControlBytes(when.trim()) : null,
    },
  };
}

/**
 * Replace each raw control byte with its JSON-escaped spelling (ESC becomes
 * the six characters backslash-u-0-0-1-b, LF becomes backslash-n, …) so the
 * value stays display-safe AND lossless — the escaped form is visible instead
 * of interpreted. Printable text passes through unchanged.
 */
function escapeControlBytes(value: string): string {
  return value.replace(/\p{Cc}/gu, (ch) => JSON.stringify(ch).slice(1, -1));
}

/**
 * Strict PRINTABLE JSON-string shape: a double-quoted scalar whose decoded
 * value provably contains no control bytes. The only escapes admitted are
 * `\"` `\\` `\/` — the ones that decode to printables. Escapes that decode to
 * control bytes (`\n`, `\t`, `\b\f\r`, `\uXXXX`) deliberately do NOT match
 * (CR R4 on mmnto-ai/totem#2134): a control-bearing quoted subject would
 * otherwise decode into raw ESC/newline that `formatTextResult` writes to
 * stderr — the same terminal-injection class the agent-id guard blocks.
 * Likewise hand-authored asymmetric quotes, raw control bytes, and single
 * quotes — all read verbatim.
 */
const PRINTABLE_JSON_STRING_SCALAR = /^"(?:[^"\\\p{Cc}]|\\["\\/])*"$/u;

/**
 * Undo `yamlScalar`'s double-quoting on read so quoted scalars round-trip:
 * compose → parse → `Re: <subject>` must not accrete quotes, and `pollMail`
 * must surface the subject the sender typed (CR R3 on mmnto-ai/totem#2134).
 * The shape pre-check makes `JSON.parse` infallible here — no catch needed —
 * and confines unquoting to printable-only strings, so a wire value encoding
 * control bytes surfaces in its escaped spelling instead of decoding into the
 * terminal (display stays lossless AND injection-free), and reader behavior
 * for legacy/hand-authored mail is unchanged.
 */
function unquoteScalar(value: string): string {
  return PRINTABLE_JSON_STRING_SCALAR.test(value) ? (JSON.parse(value) as string) : value;
}

/**
 * Build the set of basenames that should be skipped because they have
 * already been actioned. Drains `processed/` and `processed/_broadcast/`
 * for each SELF_AGENT in the calling repo.
 */
function buildProcessedSet(
  repoRoot: string,
  selfAgents: string[],
  warnings: string[],
): Set<string> {
  const processed = new Set<string>();
  for (const agent of selfAgents) {
    const agentDir = path.join(repoRoot, '.totem', 'orchestration', agent, 'processed');
    drainProcessedDir(agentDir, processed, warnings);
    drainProcessedDir(path.join(agentDir, '_broadcast'), processed, warnings);
  }
  return processed;
}

function drainProcessedDir(dir: string, into: Set<string>, warnings: string[]): void {
  if (!fs.existsSync(dir)) return;
  // totem-context: intentional cleanup — an unreadable processed/ subtree (EACCES, race with concurrent rename) emits a warning and degrades to a stale exclusion set rather than blocking the poll. Mail still surfaces; the agent may see already-actioned items in that worst case, which is observable (the warning) rather than silent.
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.md')) into.add(entry);
    }
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    warnings.push(`processed/ scan failed (${dir}): ${String(err)}`);
  }
}

// ─── Workspace scan ─────────────────────────────────────

/**
 * One slot of work for the scanner: an outbox directory to walk plus the
 * repo + agent labels for surfacing.
 */
interface OutboxSlot {
  repo: string;
  agent: string;
  outbox: string;
}

/**
 * Enumerate outbox directories under `<workspace>/<repo>/.totem/orchestration/<agent>/outbox`.
 * Single-level by default; recursive mode walks `<workspace>/**` (capped at MAX_SCAN
 * to bound runtime on deep trees).
 */
function enumerateOutboxes(
  workspace: string,
  recursive: boolean,
  warnings: string[],
): OutboxSlot[] {
  const slots: OutboxSlot[] = [];

  if (!fs.existsSync(workspace)) {
    warnings.push(`workspace does not exist: ${workspace}`);
    return slots;
  }

  let repos: string[];
  try {
    repos = fs
      .readdirSync(workspace, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name)
      .sort();
    // totem-context: intentional cleanup — a workspace readdir failure (EACCES, ENOTDIR via raced symlink) is recorded as a structured warning so the CLI surfaces it; throwing here would block hook-driven session start over a non-fatal scan issue.
  } catch (err) {
    warnings.push(`workspace scan failed: ${String(err)}`);
    return slots;
  }

  const visit = (repoLabel: string, orchDir: string): void => {
    if (!fs.existsSync(orchDir)) return;
    let agents: string[];
    try {
      agents = fs.readdirSync(orchDir).sort();
      // totem-context: intentional cleanup — per-repo readdir failure skips this slot, emits a structured warning, and lets sibling repos continue; one inaccessible orchestration tree must not block the rest of the scan.
    } catch (err) {
      warnings.push(`orchestration scan failed (${repoLabel}): ${String(err)}`);
      return;
    }
    for (const agent of agents) {
      const outbox = path.join(orchDir, agent, 'outbox');
      if (fs.existsSync(outbox)) {
        slots.push({ repo: repoLabel, agent, outbox });
      }
    }
  };

  if (!recursive) {
    for (const repo of repos) {
      visit(repo, path.join(workspace, repo, '.totem', 'orchestration'));
    }
    return slots;
  }

  // Recursive variant: descend into each top-level repo and look for any
  // `.totem/orchestration/` under it. Bounded depth so a malformed tree
  // can't pin us — the MAX_SCAN file-open cap is the second guard.
  const RECURSIVE_DEPTH_CAP = 6;
  const stack: Array<{ dir: string; label: string; depth: number }> = repos.map((r) => ({
    dir: path.join(workspace, r),
    label: r,
    depth: 0,
  }));
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node.label, path.join(node.dir, '.totem', 'orchestration'));
    if (node.depth >= RECURSIVE_DEPTH_CAP) continue;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(node.dir, { withFileTypes: true });
      // totem-context: intentional cleanup — recursive-descent readdir failure on one node emits a structured warning and skips that subtree; a single inaccessible dir must not abort the whole scan.
    } catch (err) {
      warnings.push(`recursive scan failed (${node.dir}): ${String(err)}`);
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.')) continue;
      if (child.name === 'node_modules') continue;
      stack.push({
        dir: path.join(node.dir, child.name),
        // Use the immediate-parent directory name as the repo label for
        // nested layouts (e.g. `wrapper/nested-strategy/.totem/orchestration/`
        // surfaces as repo='nested-strategy'). The top-level label is
        // misleading when the orchestration tree lives under a wrapper dir.
        label: child.name,
        depth: node.depth + 1,
      });
    }
  }
  return slots;
}

// ─── Core poll ──────────────────────────────────────────

/**
 * Programmatic entry point. Returns a structured `MailPollResult` for
 * consumers that want to render their own output (hooks, MCP audits,
 * future surfaces). The CLI wrapper calls this then formats the result
 * for human consumption.
 *
 * Never throws — filesystem failures degrade to warnings on the result.
 */
export function pollMail(opts: MailCommandOptions = {}): MailPollResult {
  const env = opts.env ?? process.env;
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());

  const workspaceRaw = opts.workspace ?? env['TOTEM_WORKSPACE'] ?? path.dirname(repoRoot);
  const workspace = path.resolve(workspaceRaw);

  const selfResolution = resolveSelfAgents(repoRoot, env);
  const selfLower = new Set(selfResolution.agents.map((a) => a.toLowerCase()));

  const warnings: string[] = [];
  if (selfResolution.agents.length === 0) {
    warnings.push(
      `no SELF_AGENT resolved (set TOTEM_SELF_AGENT, add .totem/orchestration/config.json host_agents, or run from a known cohort repo)`,
    );
  }

  const processedNames =
    selfResolution.agents.length > 0
      ? buildProcessedSet(repoRoot, selfResolution.agents, warnings)
      : new Set<string>();

  const slots = enumerateOutboxes(workspace, opts.recursive === true, warnings);

  // Two-pass scan for global newest-first fairness under MAX_SCAN.
  // Pass 1 (cheap): readdirSync every outbox to collect all unread filenames.
  // Pass 2 (expensive): sort globally by filename (ISO-timestamp prefix), then
  // readFileSync only the top MAX_SCAN. Without the global sort, alphabet-early
  // repos can exhaust the cap before later repos are touched (per GCA review on
  // mmnto-ai/totem#1971). Pre-collect of cheap reads is faster than the prior
  // interleaved per-slot loop when truncation actually trips.
  const unread: Array<{ slot: OutboxSlot; file: string }> = [];
  for (const slot of slots) {
    let files: string[];
    try {
      files = fs.readdirSync(slot.outbox).filter((f) => f.endsWith('.md'));
      // totem-context: intentional cleanup — outbox readdir failure (mid-rename race, EACCES, removed-during-scan) emits a structured warning and skips this slot.
    } catch (err) {
      warnings.push(`outbox scan failed (${slot.repo}/${slot.agent}): ${String(err)}`);
      continue;
    }
    for (const file of files) {
      if (processedNames.has(file)) continue;
      unread.push({ slot, file });
    }
  }

  // Global newest-first by filename. ISO-timestamp prefixes give a total
  // order; non-ISO filenames sort lexically (stable; only matters within a
  // sender's outbox).
  unread.sort((a, b) => b.file.localeCompare(a.file));

  let scanned = 0;
  let truncated = false;
  if (unread.length > MAX_SCAN) {
    truncated = true;
  }

  const mail: MailEntry[] = [];
  const inScope = unread.length > MAX_SCAN ? unread.slice(0, MAX_SCAN) : unread;
  for (const { slot, file } of inScope) {
    scanned += 1;
    let content: string;
    try {
      content = fs.readFileSync(path.join(slot.outbox, file), 'utf-8');
      // totem-context: intentional cleanup — per-file readFileSync failure emits a structured warning and skips that file; mail surfacing must degrade gracefully on a single unreadable handoff (mid-write race or transient FS hiccup).
    } catch (err) {
      warnings.push(`mail read failed (${slot.repo}/${slot.agent}/${file}): ${String(err)}`);
      continue;
    }
    const parsed = parseHeader(content);
    if (!parsed.ok) {
      // Tenet 4 parity with the readFileSync path above: a mail-shaped file
      // that fails to parse is the silent-drop hazard (mmnto-ai/totem#2118 —
      // eight real dispatches vanished without a trace). Non-mail-shaped
      // strays stay silent by design (see HeaderParse).
      if (parsed.mailShaped) {
        warnings.push(`mail parse failed (${slot.repo}/${slot.agent}/${file}): ${parsed.reason}`);
      }
      continue;
    }
    const header = parsed.header;
    const toLower = header.to.toLowerCase();
    if (toLower !== 'broadcast' && !selfLower.has(toLower)) continue;
    mail.push({
      file,
      repo: slot.repo,
      from: header.from ?? slot.agent,
      to: header.to,
      date: header.date,
      subject: header.subject ?? '(no subject)',
      filePath: path.join(slot.outbox, file),
    });
  }

  // Re-sort the surviving mail by frontmatter date when available (filename
  // sort already handled the primary order; this refines for files whose
  // `date:` differs from the filename prefix).
  mail.sort((a, b) => (b.date ?? b.file).localeCompare(a.date ?? a.file));

  return {
    selfAgents: { agents: [...selfResolution.agents], source: selfResolution.source },
    mail,
    scanned,
    truncated,
    workspace,
    warnings,
  };
}

// ─── Output formatting ──────────────────────────────────

function formatTextResult(result: MailPollResult): string {
  const lines: string[] = [];
  const selfList =
    result.selfAgents.agents.length > 0 ? result.selfAgents.agents.join(', ') : '(none)';
  lines.push(`Workspace: ${result.workspace}`);
  lines.push(`Self agents: ${selfList} (source: ${result.selfAgents.source})`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) lines.push(`Warning: ${w}`);
  }
  if (result.mail.length === 0) {
    lines.push(`No unread mail addressed to ${selfList} or broadcast.`);
  } else {
    lines.push(`${result.mail.length} unread:`);
    for (const m of result.mail) {
      lines.push(`  - ${m.file} (from ${m.from} @ ${m.repo}, to: ${m.to})`);
      lines.push(`      subject: ${m.subject}`);
    }
  }
  if (result.truncated) {
    lines.push(`[scan truncated at ${result.scanned} files; raise concern if this persists]`);
  }
  return lines.join('\n');
}

// ─── CLI entry ──────────────────────────────────────────

export async function mailCommand(opts: MailCommandOptions = {}): Promise<MailPollResult> {
  const result = pollMail(opts);

  if (opts.json === true) {
    // JSON output goes to stdout (hook-friendly); structured logger goes to stderr
    // via the standard CLI path. Using process.stdout keeps the JSON stream clean.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  const { log } = await import('../ui.js');
  const text = formatTextResult(result);
  // log.info is stderr-bound across the CLI; mail output is informational,
  // not a primary data product, so it joins the stderr stream consumers
  // already attach to.
  for (const line of text.split('\n')) {
    log.info(TAG, line);
  }

  return result;
}

// ─── Outbound: send / reply (mmnto-ai/totem#2042) ───────
//
// The actuator half of the ADR-106 coordination triad (sensor = `pollMail`
// above). Before this, `totem mail send` silently fell through to the read
// command and every dispatch was hand-authored against five undocumented
// conventions — a discipline the protocol structurally could not satisfy
// (Tenet 13: sensor without actuator). Three composing validity layers,
// none violating ADR-106 inv6 (fail-open transport):
//
//   structural  — v0.4 compliance by CONSTRUCTION (the `DispatchHeader` type
//                 makes a malformed-shape dispatch unrepresentable);
//   content     — predicates that can't be guaranteed at construction
//                 (recipient known? refs non-empty?) → LOUD warn + write
//                 anyway (a blocked dispatch is worse than a malformed one,
//                 the mmnto-ai/totem#2119 exhibit);
//   reader      — `pollMail`'s scan-errors-always-warn is the never-silent
//                 -drop backstop.
//
// (OQ-1 ruled 1b by satur8d 2026-06-09; emit-shape + reader `timestamp:` read
// concurred by strategy-claude, ADR-098 owner, same day.)

/** ADR-098 v0.4 canonical schema literal emitted by the actuator. */
const ADR098_SCHEMA = 'adr-098-v0.4';

/**
 * Structurally-complete dispatch header. ADR-098 v0.4 compliance is enforced
 * *by construction*: you cannot build this object without `schema` / `from` /
 * `to` / `timestamp` / `subject` / `expectedAction`, so a structurally invalid
 * dispatch is unrepresentable rather than rejected after the fact — the
 * strongest form of "enforce via substrate" (inv2 realized). The content
 * predicates that CANNOT be guaranteed at construction time (is the recipient
 * a known agent? do refs resolve?) are the validator's job, and warn rather
 * than block (inv6).
 */
export interface DispatchHeader {
  schema: string;
  from: string;
  to: string;
  /** Full RFC3339 UTC, e.g. `2026-06-09T17:34:37.127Z` (ADR-098 v0.4). */
  timestamp: string;
  subject: string;
  /** ADR-098 v0.4 mandatory; the `none` literal for informational dispatches. */
  expectedAction: string;
  inReplyTo?: string;
  priority?: string;
  related?: string[];
}

export interface MailSendOptions {
  /** Recipient agent-id (or `broadcast`). */
  to: string;
  /** Subject line (the cohort convention carries the gist here). */
  subject: string;
  /** Sender agent-id; default resolves from self, erroring if ambiguous. */
  from?: string;
  /** Read the dispatch body from this file (hard error if unreadable). */
  bodyFile?: string;
  /** Direct body text (test/stdin seam); `bodyFile` overrides when both set. */
  body?: string;
  /** `in-reply-to:` frontmatter — the source dispatch path. */
  inReplyTo?: string;
  /** `priority:` frontmatter. */
  priority?: string;
  /** `related-issues:` frontmatter list. */
  related?: string[];
  /** `expected-action:` frontmatter; defaults to the `none` literal. */
  expectedAction?: string;
  /** Filename slug override; default derived from the subject. */
  slug?: string;
  /** Repo root (default: cwd). Test injection point. */
  repoRoot?: string;
  /** Env override (default: process.env). Test injection point. */
  env?: Record<string, string | undefined>;
  /** Clock injection for deterministic timestamps/filenames in tests. */
  now?: () => Date;
  /** Known-recipient set override (default: `knownCohortAgents()`). */
  knownAgents?: readonly string[];
}

export interface MailSendResult {
  /** Absolute path of the written dispatch. */
  filePath: string;
  /** Basename of the written dispatch. */
  fileName: string;
  /** The composed (structurally-valid-by-construction) header. */
  header: DispatchHeader;
  /** Content-class warnings surfaced at emit-time; dispatch still written. */
  warnings: string[];
}

/**
 * Double-quote a frontmatter scalar (JSON form is a valid YAML double-quoted
 * scalar) only when the raw value would otherwise mis-parse: edge whitespace,
 * a newline/quote, a leading flow/indicator char, or a `: ` / ` #` sequence
 * (YAML's map-value + comment triggers). Now that the actuator is the
 * v0.4-compliant emitter, the output must be real YAML — the derivation engine
 * will parse it, unlike the regex reader. Refs like `owner/repo#123` (no space
 * before `#`) stay unquoted, matching the de-facto wire.
 */
function yamlScalar(value: string): string {
  const needsQuote =
    value === '' ||
    value !== value.trim() ||
    /[\n"]/.test(value) ||
    /^[[\]{}>|*&!%@`'"#-]/.test(value) ||
    /:\s/.test(value) ||
    /\s#/.test(value) ||
    // YAML 1.1 plain-scalar coercion traps: a bare boolean/null/numeric-shaped
    // value would parse as a non-string once the derivation engine YAML-parses
    // the wire (GCA R3 on mmnto-ai/totem#2134; incl. YAML 1.1's bare y/n and
    // exponential/trailing-dot floats). Quote to pin the string type.
    /^(?:y|n|yes|no|true|false|on|off|null|~)$/i.test(value) ||
    /^[+-]?(?:\d+\.?|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
  return needsQuote ? JSON.stringify(value) : value;
}

/**
 * Serialize a dispatch header + body to ADR-098 v0.4 markdown. Pure +
 * deterministic — the round-trip anchor: its output MUST parse back through
 * `parseHeader` (the sensor↔actuator "one enumeration, two readers" pairing).
 * Frontmatter keys are kebab-case wire form, the surface the reader greps.
 */
export function composeDispatch(header: DispatchHeader, body: string): string {
  const lines: string[] = ['---'];
  lines.push(`schema: ${header.schema}`);
  // `from`/`to` are traversal-validated agent-ids, but YAML-quote them anyway
  // (defense in depth) so a non-standard recipient can't inject frontmatter
  // once the v0.4 derivation engine YAML-parses this (CodeRabbit, mmnto-ai/totem#2134).
  lines.push(`from: ${yamlScalar(header.from)}`);
  lines.push(`to: ${yamlScalar(header.to)}`);
  lines.push(`timestamp: ${header.timestamp}`);
  lines.push(`subject: ${yamlScalar(header.subject)}`);
  lines.push(`expected-action: ${yamlScalar(header.expectedAction)}`);
  if (header.inReplyTo !== undefined) lines.push(`in-reply-to: ${yamlScalar(header.inReplyTo)}`);
  if (header.priority !== undefined) lines.push(`priority: ${yamlScalar(header.priority)}`);
  if (header.related !== undefined && header.related.length > 0) {
    lines.push('related-issues:');
    for (const ref of header.related) lines.push(`  - ${yamlScalar(ref)}`);
  }
  lines.push('---');
  lines.push('');
  // Exactly one trailing newline on the body for stable round-trips.
  lines.push(body.replace(/\s+$/, ''));
  lines.push('');
  return lines.join('\n');
}

/**
 * Content-class validation (inv1: exact predicates only — set membership and
 * non-emptiness, never judgment). NEVER throws, NEVER blocks: returns warnings
 * the caller surfaces at emit-time and writes anyway (inv6). The headline check
 * is the unknown-recipient typo class (strategy-claude 2026-06-09): a typo'd
 * recipient writes under a wrong name and is undelivered-but-not-errored unless
 * the sender is told loudly.
 */
export function validateDispatchContent(
  header: { to: string; related?: string[] },
  knownAgents: readonly string[],
): string[] {
  const warnings: string[] = [];
  const to = header.to.trim();
  const known = new Set(knownAgents.map((a) => a.toLowerCase()));
  if (to.toLowerCase() !== 'broadcast' && !known.has(to.toLowerCase())) {
    warnings.push(
      `recipient "${to}" is not a known cohort agent — the dispatch WILL be written but may be undeliverable (check for a typo). Known: ${[...knownAgents].sort().join(', ')}, broadcast.`,
    );
  }
  if (header.related !== undefined) {
    for (const ref of header.related) {
      if (ref.trim().length === 0) {
        warnings.push('a related-issues entry is empty/whitespace (kept verbatim).');
      }
    }
  }
  return warnings;
}

/**
 * Resolve the single sender identity for an outbound dispatch. Unlike the
 * reader (which resolves a SET of self-agents to filter by), send must pick
 * ONE. Precedence: explicit `--from` > unambiguous `resolveSelfAgents` > error.
 * A >1 ambiguous map (e.g. totem hosts both totem-claude + totem-gemini) is a
 * hard usage error — never silently pick one (it would mis-attribute the
 * dispatch). Zero is a hard error too — never write to `.../undefined/outbox`.
 */
export function resolveSelfSender(
  repoRoot: string,
  env: Record<string, string | undefined>,
  explicitFrom?: string,
): string {
  if (explicitFrom !== undefined && explicitFrom.trim().length > 0) {
    return explicitFrom.trim();
  }
  const resolved = resolveSelfAgents(repoRoot, env);
  if (resolved.agents.length === 1) return resolved.agents[0]!;
  if (resolved.agents.length === 0) {
    throw new TotemError(
      'MAIL_SEND_FAILED',
      'cannot resolve a sender identity for the outbound dispatch',
      'set TOTEM_SELF_AGENT or pass --from <agent-id>.',
    );
  }
  throw new TotemError(
    'MAIL_SEND_FAILED',
    `ambiguous sender — this repo hosts ${resolved.agents.join(', ')}`,
    'pass --from <agent-id> to disambiguate.',
  );
}

function assertSafeAgentId(id: string, label: string): void {
  // Reuse core's single path-segment guard (`isPathSafeAgentId`) rather than
  // re-deriving the pattern — both the sender's `--from` (an outbox directory
  // segment) and the recipient's `--to` (interpolated into the filename) must
  // be blocked from `/`, `\`, `..`, a null byte (Greptile P2 / GCA + CR
  // path-traversal critical, mmnto-ai/totem#2134), and from control/
  // whitespace/win32-reserved characters that would propagate into the
  // dispatch markdown and CLI logs (CR R2, same PR).
  if (!isPathSafeAgentId(id)) {
    // JSON-escape the echoed id: this rejection path exists precisely because
    // the value may carry control bytes — echoing it raw to stderr would
    // re-create the terminal injection it blocks (CR R3 on mmnto-ai/totem#2134).
    throw new TotemError(
      'MAIL_SEND_FAILED',
      `invalid --${label} ${JSON.stringify(id)} (path-traversal, unsafe characters, or empty)`,
      'pass a plain agent-id such as "totem-claude" (no path separators, "..", whitespace, or control characters).',
    );
  }
}

/**
 * Reduce a recipient/agent token to a filename-safe form: a defense-in-depth
 * layer on top of `assertSafeAgentId` (which already rejects traversal). Even a
 * validated-but-odd `to` (e.g. a stray `:`/space — illegal in win32 filenames)
 * cannot corrupt the outbox filename. Valid kebab agent-ids pass through
 * unchanged; `broadcast` is preserved.
 */
function fileToken(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'recipient';
}

/**
 * Filename-safe minute-granularity UTC stamp: `YYYY-MM-DDTHHMMZ`. Colons are
 * illegal in win32 filenames (strategy-claude 2026-06-09, non-negotiable) and
 * this matches every existing outbox name; the frontmatter carries the full
 * RFC3339 `timestamp:` separately.
 */
function compactStamp(d: Date): string {
  const iso = d.toISOString();
  // `17:34` → `1734` (drop the colon, illegal in win32 filenames).
  const hhmm = iso.slice(11, 16).replace(':', '');
  return `${iso.slice(0, 10)}T${hhmm}Z`;
}

/** Short, kebab filename slug (concise-dispatch-filename discipline: ~3-6 words). */
function slugify(subject: string, explicit?: string): string {
  const source = explicit !== undefined && explicit.trim().length > 0 ? explicit : subject;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter((s) => s.length > 0)
    .slice(0, 6)
    .join('-')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'dispatch';
}

/**
 * First non-colliding outbox path for `<base>.md`, suffixing `-2`, `-3`, … on
 * collision (two dispatches to the same recipient in the same minute with the
 * same slug). Deterministic — no randomness.
 */
function uniqueOutboxPath(outboxDir: string, base: string): string {
  let candidate = path.join(outboxDir, `${base}.md`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outboxDir, `${base}-${n}.md`);
    n += 1;
  }
  return candidate;
}

/**
 * Compose + validate + write an outbound dispatch to the sender's own outbox.
 * Structural validity is by construction; content warnings are returned (the
 * CLI wrapper surfaces them loudly) and never block the write. The only HARD
 * failures are usage errors (missing to/subject, unresolvable/ambiguous self,
 * unreadable body-file) and actuation failure (a write that didn't land —
 * fail-loud, Tenet 4, the opposite of the inv6 content case).
 */
export function mailSend(opts: MailSendOptions): MailSendResult {
  const env = opts.env ?? process.env;
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const now = (opts.now ?? (() => new Date()))();

  const to = opts.to.trim();
  if (to.length === 0)
    throw new TotemError(
      'MAIL_SEND_FAILED',
      '--to <recipient> is required',
      'pass --to <recipient-agent-id> (or "broadcast").',
    );
  // `to` is interpolated into the outbox filename + the frontmatter — block
  // path-traversal here, same guard as `from` (GCA/Greptile/CR critical, mmnto-ai/totem#2134).
  assertSafeAgentId(to, 'to');
  const subject = opts.subject.trim();
  if (subject.length === 0)
    throw new TotemError(
      'MAIL_SEND_FAILED',
      '--subject <text> is required',
      'pass --subject "<text>".',
    );

  const from = resolveSelfSender(repoRoot, env, opts.from);
  assertSafeAgentId(from, 'from');

  // Body precedence: bodyFile > body > empty. A declared --body-file that can't
  // be read is a hard usage error — the intended body is lost, never silently
  // ship an empty dispatch in its place.
  let body = opts.body ?? '';
  if (opts.bodyFile !== undefined) {
    try {
      body = fs.readFileSync(opts.bodyFile, 'utf-8');
      // totem-context: a declared --body-file that can't be read is a hard usage error (the user named a body source that doesn't resolve); rethrow as a clear message rather than degrade to an empty dispatch.
    } catch (err) {
      throw new TotemError(
        'MAIL_SEND_FAILED',
        `--body-file unreadable (${opts.bodyFile}): ${String(err)}`,
        'check the --body-file path exists and is readable.',
        err,
      );
    }
  }

  const header: DispatchHeader = {
    schema: ADR098_SCHEMA,
    from,
    to,
    timestamp: now.toISOString(),
    subject,
    expectedAction: opts.expectedAction?.trim() || 'none',
    ...(opts.inReplyTo !== undefined ? { inReplyTo: opts.inReplyTo } : {}),
    ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
    ...(opts.related !== undefined && opts.related.length > 0 ? { related: opts.related } : {}),
  };

  const warnings = validateDispatchContent(header, opts.knownAgents ?? knownCohortAgents());

  const outboxDir = path.join(repoRoot, '.totem', 'orchestration', from, 'outbox');
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
    // totem-context: a failed outbox mkdir (EACCES, read-only FS, a file where
    // the dir should be) means the dispatch cannot land — fail LOUD (Tenet 4)
    // with the path, never proceed to a write that will also fail (GCA mmnto-ai/totem#2134).
  } catch (err) {
    throw new TotemError(
      'MAIL_SEND_FAILED',
      `could not create outbox directory (${outboxDir}): ${String(err)}`,
      'check write permissions on the repo .totem/orchestration tree.',
      err,
    );
  }

  const base = `${compactStamp(now)}-${fileToken(to)}-${slugify(subject, opts.slug)}`;
  const filePath = uniqueOutboxPath(outboxDir, base);
  const content = composeDispatch(header, body);

  // Atomic write (ADR-106: temp + rename; readers never see a torn write).
  const tmp = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Actuation failure is fail-LOUD (Tenet 4): a write that did not land is a
    // silent drop — the inverse of the inv6 content-warn case. Best-effort
    // remove any partial temp first (force suppresses ENOENT; maxRetries/
    // retryDelay guard a transient win32 lock), then surface the original
    // error with the path so the sender knows nothing shipped.
    const hint = 'check outbox directory permissions and available disk space.';
    try {
      fs.rmSync(tmp, { force: true, maxRetries: 3, retryDelay: 50 });
    } catch (cleanupErr) {
      // A failed cleanup must not shadow the actuation error (GCA R2 on
      // mmnto-ai/totem#2134): rethrow the ORIGINAL failure as the cause, with
      // the stranded-temp note folded into the message so both stay visible.
      throw new TotemError(
        'MAIL_SEND_FAILED',
        `write failed (${filePath}): ${String(err)} (temp file ${tmp} could not be removed: ${String(cleanupErr)})`,
        hint,
        err,
      );
    }
    throw new TotemError(
      'MAIL_SEND_FAILED',
      `write failed (${filePath}): ${String(err)}`,
      hint,
      err,
    );
  }

  return { filePath, fileName: path.basename(filePath), header, warnings };
}

/**
 * `totem mail reply <source>` — syntactic sugar over `mailSend`. Reads the
 * source dispatch (HARD error if missing/unparseable — reply structurally needs
 * it to infer the recipient + subject), then sends with `to = source.from`
 * (falling back to the source's outbox-dir agent, reader parity),
 * `subject = "Re: <source.subject>"`, and `in-reply-to` set to the source's
 * repo-relative wire form. Any field can still be overridden via opts.
 */
export function mailReply(
  source: string,
  opts: Omit<MailSendOptions, 'to' | 'subject' | 'inReplyTo'> & {
    to?: string;
    subject?: string;
  } = {},
): MailSendResult {
  let content: string;
  try {
    content = fs.readFileSync(source, 'utf-8');
    // totem-context: reply cannot proceed without the source (it infers to/subject from it) — a missing/unreadable source is a hard usage error, rethrown clearly, not a degraded send.
  } catch (err) {
    throw new TotemError(
      'MAIL_SEND_FAILED',
      `cannot read reply source dispatch (${source}): ${String(err)}`,
      'check the reply <source> path exists and is readable.',
      err,
    );
  }
  const parsed = parseHeader(content);
  if (!parsed.ok) {
    throw new TotemError(
      'MAIL_SEND_FAILED',
      `reply source is not parseable mail (${source}): ${parsed.reason}`,
      'the source must be an ADR-098 dispatch with a frontmatter block; use `mail send --to` for a fresh dispatch.',
    );
  }
  // Reader-parity fallback (CR R3 on mmnto-ai/totem#2134): `pollMail` accepts
  // a dispatch without `from:` by falling back to the outbox directory name,
  // so a reply to such mail must not hard-fail where the reader succeeded —
  // derive the sender from the `<agent>/outbox/<file>` layout.
  const replyTo = opts.to ?? parsed.header.from ?? senderFromSourcePath(source) ?? '';
  if (replyTo.trim().length === 0) {
    throw new TotemError(
      'MAIL_SEND_FAILED',
      `reply source has no "from:" to reply to (${source})`,
      'use `totem mail send --to <agent>` instead.',
    );
  }
  const subject = opts.subject ?? `Re: ${parsed.header.subject ?? '(no subject)'}`;
  return mailSend({ ...opts, to: replyTo, subject, inReplyTo: portableSourceRef(source) });
}

/**
 * Derive the sender agent-id from a dispatch path's `<agent>/outbox/<file>`
 * layout — the same fallback `pollMail` applies when frontmatter omits
 * `from:` (reader↔reply parity, CR R3 on mmnto-ai/totem#2134).
 */
function senderFromSourcePath(source: string): string | null {
  const segments = path.resolve(source).split(/[/\\]/);
  const outboxIdx = segments.lastIndexOf('outbox');
  return outboxIdx > 0 ? (segments[outboxIdx - 1] ?? null) : null;
}

/**
 * Reduce a reply-source path to the portable repo-relative wire form
 * (`.totem/orchestration/<agent>/outbox/<file>` — the de-facto cohort shape
 * for `in-reply-to:`) so an absolute local path never leaks machine-specific
 * structure (drive letters, usernames) into shared frontmatter (GCA R3 on
 * mmnto-ai/totem#2134). Falls back to the basename when the source lives
 * outside a recognizable orchestration tree.
 */
function portableSourceRef(source: string): string {
  const normalized = source.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('.totem/orchestration/');
  return idx >= 0 ? normalized.slice(idx) : path.basename(source);
}

/**
 * CLI wrapper for `mail send` / `mail reply`. Surfaces content warnings LOUDLY
 * on stderr at emit-time (inv6: the dispatch still wrote — this is the typo
 * backstop, not a block), then confirms the written path.
 */
export async function mailSendCommand(result: MailSendResult): Promise<MailSendResult> {
  const { log } = await import('../ui.js');
  for (const w of result.warnings) log.warn(TAG, w);
  log.success(TAG, `Dispatch written: ${path.relative(process.cwd(), result.filePath)}`);
  log.info(
    TAG,
    `  to: ${result.header.to} · from: ${result.header.from} · ${result.header.timestamp}`,
  );
  return result;
}
