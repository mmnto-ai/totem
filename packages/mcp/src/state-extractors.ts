/**
 * State extractors for the rich `describe_project` payload.
 *
 * Each extractor reads from local git, filesystem, or stored-state files and
 * returns its schema shape. On missing source files or non-zero git exit,
 * extractors degrade gracefully (null / 0 / []) rather than throwing, so the
 * MCP handler can compose a partial payload instead of crashing.
 *
 * ADR-090 substrate invariant: no LLM calls, no live npm/github registry
 * calls. Every function reads only from disk or local git state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { CompiledRulesFileSchema, readJsonSafe, resolveGitRoot, safeExec } from '@mmnto/totem';

import {
  type GitState,
  type MilestoneState,
  RECENT_PRS_COUNT,
  type RecentPr,
  type RuleCounts,
  type StrategyPointer,
  UNCOMMITTED_FILES_CAP,
} from './schemas/describe-project.js';

/** Fixed-group package names whose versions show in the briefing. */
const FIXED_GROUP_PACKAGES = [
  '@mmnto/totem',
  '@mmnto/cli',
  '@mmnto/mcp',
  '@totem/pack-agent-security',
] as const;

// ─── Git state ─────────────────────────────────────────────────────────────

export function extractGitState(cwd: string): GitState {
  if (resolveGitRoot(cwd) === null) {
    return { branch: null, uncommittedFiles: [], truncated: false };
  }

  let branch: string | null = null;
  try {
    const out = safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    branch = out === 'HEAD' ? null : out;
  } catch {
    branch = null;
  }

  let allFiles: string[] = [];
  try {
    const porcelain = safeExec('git', ['status', '--porcelain'], { cwd });
    if (porcelain.length > 0) {
      allFiles = porcelain
        .split(/\r?\n/)
        .map((line) => line.slice(3).trim())
        .filter((name) => name.length > 0);
    }
  } catch {
    allFiles = [];
  }

  const truncated = allFiles.length > UNCOMMITTED_FILES_CAP;
  const uncommittedFiles = truncated ? allFiles.slice(0, UNCOMMITTED_FILES_CAP) : allFiles;
  return { branch, uncommittedFiles, truncated };
}

// ─── Strategy submodule pointer ────────────────────────────────────────────

export function extractStrategyPointer(cwd: string): StrategyPointer {
  const strategyDir = path.join(cwd, '.strategy');
  if (!fs.existsSync(strategyDir)) {
    return { sha: null, latestJournal: null };
  }

  let sha: string | null = null;
  try {
    const full = safeExec('git', ['rev-parse', 'HEAD'], { cwd: strategyDir });
    sha = full.length >= 7 ? full.slice(0, 7) : null;
  } catch {
    sha = null;
  }

  let latestJournal: string | null = null;
  try {
    const journalDir = path.join(strategyDir, '.journal');
    if (fs.existsSync(journalDir)) {
      const entries = fs
        .readdirSync(journalDir)
        .filter((f) => f.endsWith('.md'))
        .sort();
      latestJournal = entries.length > 0 ? entries[entries.length - 1]! : null;
    }
  } catch {
    latestJournal = null;
  }

  return { sha, latestJournal };
}

// ─── Package versions (fixed group only) ───────────────────────────────────

export function extractPackageVersions(cwd: string): Record<string, string> {
  const result: Record<string, string> = {};
  const packagesDir = path.join(cwd, 'packages');
  if (!fs.existsSync(packagesDir)) return result;

  let subdirs: string[];
  try {
    subdirs = fs.readdirSync(packagesDir);
  } catch {
    return result;
  }

  for (const subdir of subdirs) {
    const pkgJson = path.join(packagesDir, subdir, 'package.json');
    try {
      const parsed = readJsonSafe<{ name?: string; version?: string }>(pkgJson);
      if (
        parsed.name !== undefined &&
        parsed.version !== undefined &&
        (FIXED_GROUP_PACKAGES as readonly string[]).includes(parsed.name)
      ) {
        result[parsed.name] = parsed.version;
      }
    } catch {
      // Missing / unparseable package.json is a non-fatal skip.
    }
  }
  return result;
}

// ─── Rule counts from .totem/compiled-rules.json ───────────────────────────

export function extractRuleCounts(cwd: string, totemDir: string): RuleCounts {
  const rulesPath = path.join(cwd, totemDir, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    return { active: 0, archived: 0, nonCompilable: 0 };
  }

  try {
    const parsed = readJsonSafe(rulesPath, CompiledRulesFileSchema);
    let active = 0;
    let archived = 0;
    for (const rule of parsed.rules) {
      if ((rule as { status?: string }).status === 'archived') archived += 1;
      else active += 1;
    }
    return {
      active,
      archived,
      nonCompilable: parsed.nonCompilable?.length ?? 0,
    };
  } catch {
    return { active: 0, archived: 0, nonCompilable: 0 };
  }
}

// ─── Lesson count ──────────────────────────────────────────────────────────

export function extractLessonCount(cwd: string, totemDir: string): number {
  const lessonsDir = path.join(cwd, totemDir, 'lessons');
  if (!fs.existsSync(lessonsDir)) return 0;
  try {
    return fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

// ─── Milestone + gate tickets from docs/active_work.md ─────────────────────

/**
 * Regex-parse the milestone name and gate-ticket list from active_work.md.
 * This is explicitly best-effort — the markdown format can drift.
 * `bestEffort: true` signals to agents that the values are a hint, not a
 * ground-truth source.
 */
export function extractMilestoneState(cwd: string): MilestoneState {
  const activeWorkPath = path.join(cwd, 'docs', 'active_work.md');
  if (!fs.existsSync(activeWorkPath)) {
    return { name: null, gateTickets: [], bestEffort: true };
  }

  let content: string;
  try {
    content = fs.readFileSync(activeWorkPath, 'utf-8');
  } catch {
    return { name: null, gateTickets: [], bestEffort: true };
  }

  // Milestone: first "### Current: X.Y.Z" heading (e.g. "### Current: 1.15.0 — The Distribution Pipeline").
  let name: string | null = null;
  const currentMatch = content.match(/^###\s+Current:\s*(\d+\.\d+\.\d+)/m);
  if (currentMatch?.[1] !== undefined) name = currentMatch[1];

  // Gate tickets: unique `#NNNN` refs inside code spans across the doc body.
  // The lint-rule registry carries lesson hashes with similar `#` prefixes, so
  // require 3-5 digits and cap at 200 entries to keep the payload tight.
  const tickets = new Set<string>();
  const ticketRe = /#(\d{3,5})\b/g;
  for (const match of content.matchAll(ticketRe)) {
    tickets.add(`#${match[1]}`);
    if (tickets.size >= 200) break;
  }

  return {
    name,
    gateTickets: Array.from(tickets),
    bestEffort: true,
  };
}

// ─── Test count (v1: always null) ──────────────────────────────────────────

/**
 * Stored test-count artifact does not exist in v1. Follow-up ticket wires
 * postmerge to stamp `.totem/store/test-stats.json` after `pnpm test` runs;
 * until then the endpoint reports null honestly rather than fabricate a
 * number.
 */
export function extractTestCount(_cwd: string): number | null {
  return null;
}

// ─── Recent merged PRs from git log ────────────────────────────────────────

/**
 * Capture squash-merge commits whose subject references a PR number
 * (`... (#NNNN)`). Skips commits whose message lacks a PR tag so we do not
 * include non-PR merges like the Version Packages auto-commit in some flows.
 */
export function extractRecentPrs(cwd: string, limit = RECENT_PRS_COUNT): RecentPr[] {
  if (resolveGitRoot(cwd) === null) return [];

  let raw: string;
  try {
    raw = safeExec(
      'git',
      ['log', `-n`, String(limit * 3), '--grep=#[0-9]\\+', '--format=%s|%cI|%h'],
      { cwd },
    );
  } catch {
    return [];
  }
  if (raw.length === 0) return [];

  const results: RecentPr[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const [title, date, squashSha] = line.split('|');
    if (
      title === undefined ||
      date === undefined ||
      squashSha === undefined ||
      !/#\d+/.test(title)
    ) {
      continue;
    }
    results.push({ title, date, squashSha });
    if (results.length >= limit) break;
  }
  return results;
}
