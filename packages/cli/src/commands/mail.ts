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

import { resolveSelfAgents } from '@mmnto/totem';

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
  /** ISO timestamp from frontmatter `date:`, or null if absent. */
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
 * Extract `to:` / `from:` / `subject:` / `date:` from a leading frontmatter
 * block. Restricts the regex search to the header (text before the first
 * blank line) so body lines starting with `to:` etc. cannot fabricate a
 * match or overwrite displayed metadata — same defense pattern as the
 * reference impl.
 *
 * Returns `null` if no `to:` field is present (the only frontmatter field
 * required for a file to be eligible mail).
 */
function parseHeader(content: string): {
  to: string;
  from: string | null;
  subject: string | null;
  date: string | null;
} | null {
  const header = content.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const toMatch = header.match(/^to:\s*(.+)$/im);
  if (!toMatch) return null;
  const fromMatch = header.match(/^from:\s*(.+)$/im);
  const subjectMatch = header.match(/^[-\s]*subject:\s*(.+)$/im);
  const dateMatch = header.match(/^date:\s*(.+)$/im);
  return {
    to: toMatch[1]!.trim(),
    from: fromMatch ? fromMatch[1]!.trim() : null,
    subject: subjectMatch ? subjectMatch[1]!.trim() : null,
    date: dateMatch ? dateMatch[1]!.trim() : null,
  };
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

  const mail: MailEntry[] = [];
  let scanned = 0;
  let truncated = false;

  outer: for (const slot of slots) {
    let files: string[];
    try {
      // Sort DESC so newest-named (ISO-timestamp prefix) is scanned first;
      // under MAX_SCAN, never drop recent unread mail in favor of stale tail.
      files = fs
        .readdirSync(slot.outbox)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse();
      // totem-context: intentional cleanup — outbox readdir failure (mid-rename race, EACCES, removed-during-scan) emits a structured warning and skips this slot.
    } catch (err) {
      warnings.push(`outbox scan failed (${slot.repo}/${slot.agent}): ${String(err)}`);
      continue;
    }
    for (const file of files) {
      if (processedNames.has(file)) continue;
      if (scanned >= MAX_SCAN) {
        truncated = true;
        break outer;
      }
      scanned += 1;
      let content: string;
      try {
        content = fs.readFileSync(path.join(slot.outbox, file), 'utf-8');
        // totem-context: intentional cleanup — per-file readFileSync failure emits a structured warning and skips that file; mail surfacing must degrade gracefully on a single unreadable handoff (mid-write race or transient FS hiccup).
      } catch (err) {
        warnings.push(`mail read failed (${slot.repo}/${slot.agent}/${file}): ${String(err)}`);
        continue;
      }
      const header = parseHeader(content);
      if (!header) continue;
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
  }

  // Newest-first sort. Date string sort works on ISO-ish timestamps used
  // in filenames; the file basename fallback preserves order when `date:`
  // is absent.
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
