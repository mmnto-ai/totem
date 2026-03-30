import * as fs from 'node:fs';
import * as path from 'node:path';

import { getGitBranch, getGitStatus, readAllLessons } from '@mmnto/totem'; // totem-ignore

import type { HandoffCheckpoint } from '../schemas/handoff-checkpoint.js';
import { HandoffCheckpointSchema } from '../schemas/handoff-checkpoint.js';
import { sanitize, wrapXml } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Handoff';
const MAX_DIFF_CHARS = 50_000;
const LESSONS_TAIL_LINES = 100;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Handoff System Prompt — End-of-Session State Transfer

## Purpose
Produce an end-of-session handoff snapshot that captures everything the next session (or the next developer) needs to resume work immediately.

## Role
You are writing a concise, tactical "End of Shift" handoff. You have access to the current git state, uncommitted changes, and lessons learned during this session. Your job is to synthesize this into a snapshot that lets the next session bootstrap instantly — no detective work required.

## Rules
- Be concrete and specific — file paths, branch names, issue numbers
- Distinguish between what IS done vs what NEEDS to be done next
- If there are uncommitted changes, describe what they represent and whether they look ready to commit
- If the working tree is clean, say so and focus on what was accomplished and what's next
- Capture any lessons or traps discovered during this session
- Be concise — this is a tactical handoff, not a retrospective

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Branch & State
[Current branch, clean/dirty status, what the branch represents]

### What Was Done
[Summary of work completed this session based on the diff and git state. If no changes, say "No uncommitted changes — session may have been exploratory or changes were already committed."]

### Uncommitted Changes
[Description of what the uncommitted changes contain and their state (staged vs unstaged). If clean, say "Working tree is clean."]

### Lessons & Traps
[Lessons learned during this session from the memory file. If none, say "No new lessons recorded this session."]

### Next Steps
[Clear, ordered list of what the next session should do first. Be specific — not "continue working" but "finish implementing X in file Y, then run tests."]
`;

// ─── Lessons file reader ────────────────────────────────

export function readRecentLessons(cwd: string, totemDir: string): string {
  const fullTotemDir = path.join(cwd, totemDir);
  const lessons = readAllLessons(fullTotemDir);
  if (lessons.length === 0) return '';

  // Combine all raw lesson text
  const combined = lessons.map((l) => l.raw).join('\n');
  const lines = combined.split('\n');

  if (lines.length <= LESSONS_TAIL_LINES) return combined.trim();

  return lines.slice(-LESSONS_TAIL_LINES).join('\n').trim();
}

// ─── Prompt assembly ────────────────────────────────────

function assemblePrompt(
  branch: string,
  status: string,
  diff: string,
  diffStat: string,
  lessons: string,
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  // Git state
  sections.push('=== GIT STATE ===');
  sections.push(`Branch: ${branch}`);
  sections.push(`Status:\n${status ? wrapXml('git_status', status) : '(clean working tree)'}`);

  // Diff
  sections.push('\n=== DIFF ===');
  if (!diff.trim()) {
    sections.push('(no uncommitted changes)');
  } else {
    if (diffStat) {
      sections.push(`Diff stat:\n${diffStat}`);
      sections.push('');
    }
    if (diff.length > MAX_DIFF_CHARS) {
      sections.push(
        wrapXml(
          'git_diff',
          diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`,
        ),
      );
    } else {
      sections.push(wrapXml('git_diff', diff));
    }
  }

  // Lessons
  sections.push('\n=== SESSION LESSONS ===');
  sections.push(lessons || '(no lessons recorded)');

  return sections.join('\n');
}

// ─── Main command ───────────────────────────────────────

export interface HandoffOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  lite?: boolean;
}

// ─── Deterministic checkpoint (ADR-039) ────────────────

export interface DeterministicCheckpoint {
  checkpoint_version: 1;
  timestamp: string;
  branch: string;
  active_files: string[];
  open_prs: number[];
}

/**
 * Parse file paths from `git status --porcelain` output.
 * Handles standard two-char status codes: " M", "M ", "MM", "A ", "??", "D ", etc.
 * Also handles renames ("R  old -> new") by extracting the new path.
 */
function parseStatusFiles(statusOutput: string): string[] {
  if (!statusOutput.trim()) return [];

  const files: string[] = [];
  for (const line of statusOutput.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Porcelain format: XY <path> or XY <old> -> <new> for renames
    let filePart = line.slice(3); // skip 2-char status + space
    const arrowIdx = filePart.indexOf(' -> ');
    if (arrowIdx >= 0) filePart = filePart.slice(arrowIdx + 4);
    // Strip C-style quotes that git adds for paths with spaces/special chars
    if (filePart.startsWith('"') && filePart.endsWith('"')) {
      filePart = filePart.slice(1, -1);
    }
    files.push(filePart);
  }
  return files;
}

/**
 * Gathers deterministic (zero-LLM) state for the handoff checkpoint.
 * ADR-039: Git Metadata Primacy — these fields come from git, never the LLM.
 */
export async function gatherDeterministicState(cwd: string): Promise<DeterministicCheckpoint> {
  // 1. Get branch — handle detached HEAD gracefully
  let branch: string;
  try {
    const raw = getGitBranch(cwd);
    branch = raw && raw !== '(unknown)' ? raw : 'HEAD';
  } catch {
    branch = 'HEAD';
  }

  // 2. Get active files from git status --porcelain (covers staged, unstaged, and untracked)
  const statusOutput = getGitStatus(cwd);
  const active_files = parseStatusFiles(statusOutput).sort();

  // 3. Return checkpoint with timestamp and empty open_prs (PR detection is future work)
  return {
    checkpoint_version: 1,
    timestamp: new Date().toISOString(),
    branch,
    active_files,
    open_prs: [],
  };
}

// ─── Semantic field extraction (Task 3) ─────────────────

/**
 * Known Markdown section headings and the semantic field they map to.
 * Headings are matched case-insensitively.
 */
const SECTION_MAP: Record<string, keyof SemanticFields> = {
  'what was done': 'completed',
  'next steps': 'remaining',
  'lessons & traps': 'context_hints',
  lessons: 'context_hints',
  'uncommitted changes': 'pending_decisions',
};

export interface SemanticFields {
  completed: string[];
  remaining: string[];
  pending_decisions: string[];
  context_hints: string[];
}

/**
 * Extract semantic fields from Markdown output by parsing section headings
 * and collecting bullet points / non-empty lines under each.
 *
 * Returns empty arrays for any sections not found or when input is malformed.
 */
export function parseSemanticFields(markdown: string): SemanticFields {
  const result: SemanticFields = {
    completed: [],
    remaining: [],
    pending_decisions: [],
    context_hints: [],
  };

  if (!markdown || !markdown.trim()) return result;

  const lines = markdown.split(/\r?\n/);
  let currentField: keyof SemanticFields | null = null;

  for (const line of lines) {
    // Detect heading (### or ##)
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      const heading = headingMatch[1]!.trim().toLowerCase();
      currentField = SECTION_MAP[heading] ?? null;
      continue;
    }

    // Collect content lines under recognized sections
    if (currentField) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '```' || trimmed.startsWith('```')) continue;
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/) ?? trimmed.match(/^\d+\.\s+(.+)$/);
      if (bulletMatch) {
        result[currentField].push(bulletMatch[1]!.trim());
      } else if (!trimmed.startsWith('#')) {
        result[currentField].push(trimmed);
      }
    }
  }

  return result;
}

// ─── Atomic checkpoint writer (Task 4) ──────────────────

/**
 * Write a JSON checkpoint file atomically: write to a .tmp file then rename.
 * Creates parent directories if needed.
 */
export function writeCheckpoint(jsonPath: string, checkpoint: HandoffCheckpoint): void {
  const dir = path.dirname(jsonPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = jsonPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, jsonPath);
}

/**
 * Determine the JSON checkpoint path given the --out option.
 * - If --out is specified: companion file with .json extension
 * - If --out is not specified: .totem/handoff.json (only if .totem/ exists)
 */
export function resolveCheckpointPath(cwd: string, outPath?: string): string | null {
  if (outPath) {
    const ext = path.extname(outPath);
    if (ext) {
      return outPath.slice(0, -ext.length) + '.json';
    }
    return outPath + '.json';
  }

  const totemDir = path.join(cwd, '.totem');
  if (fs.existsSync(totemDir)) {
    return path.join(totemDir, 'handoff.json');
  }

  return null;
}

// ─── Lite handoff (zero LLM) ────────────────────────────

const RECENT_COMMITS_COUNT = 10;

export function buildLiteHandoff(
  branch: string,
  status: string,
  diffStat: string,
  recentCommits: string,
  lessons: string,
): string {
  // Sanitize git-sourced fields to strip ANSI escapes / control chars
  const sBranch = sanitize(branch); // totem-ignore — ANSI stripping for terminal output safety
  const sStatus = sanitize(status);
  const sDiffStat = sanitize(diffStat);
  const sCommits = sanitize(recentCommits);

  const lines: string[] = [];

  lines.push('### Branch & State');
  lines.push(`${sBranch}; ${sStatus.trim() ? 'dirty working tree' : 'clean working tree'}.`);
  lines.push('');

  lines.push('### Uncommitted Changes');
  if (sStatus.trim()) {
    lines.push('```');
    lines.push(sStatus.trim());
    lines.push('```');
    if (sDiffStat.trim()) {
      lines.push('');
      lines.push('```');
      lines.push(sDiffStat.trim());
      lines.push('```');
    }
  } else {
    lines.push('Working tree is clean.');
  }
  lines.push('');

  lines.push('### Recent Commits');
  if (sCommits.trim()) {
    lines.push('```');
    lines.push(sCommits.trim());
    lines.push('```');
  } else {
    lines.push('No commits found.');
  }
  lines.push('');

  lines.push('### Lessons');
  if (lessons.trim()) {
    const lessonLines = lessons.split('\n');
    lines.push(`${lessonLines.length} lines in lessons file (last ${LESSONS_TAIL_LINES} shown).`);
  } else {
    lines.push('No lessons file found.');
  }

  return lines.join('\n');
}

// ─── Main command ───────────────────────────────────────

export async function handoffCommand(options: HandoffOptions): Promise<void> {
  const { getGitBranch, getGitDiff, getGitDiffStat, getGitLogSince, getGitStatus } =
    await import('../git.js');
  const { log } = await import('../ui.js');
  const { getSystemPrompt, loadConfig, loadEnv, resolveConfigPath, runOrchestrator, writeOutput } =
    await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Gather git state
  log.info(TAG, 'Gathering git state...');
  const branch = getGitBranch(cwd);
  const status = getGitStatus(cwd);
  log.info(TAG, `Branch: ${branch}`);

  // Get diff
  log.info(TAG, 'Getting uncommitted diff...');
  const diff = getGitDiff('all', cwd);
  const diffStat = diff.trim() ? getGitDiffStat(cwd) : '';

  if (diff.trim()) {
    log.info(TAG, `Diff: ${(diff.length / 1024).toFixed(0)}KB`);
  } else {
    log.dim(TAG, 'Working tree is clean.');
  }

  // Read recent lessons
  log.info(TAG, 'Reading recent lessons...');
  const lessons = readRecentLessons(cwd, config.totemDir);
  log.info(TAG, `Lessons: ${lessons ? `${lessons.split('\n').length} lines` : 'none found'}`);

  // Lite mode — deterministic, zero LLM
  if (options.lite) {
    const recentCommits = getGitLogSince(cwd, undefined, RECENT_COMMITS_COUNT);
    const output = buildLiteHandoff(branch, status, diffStat, recentCommits, lessons);
    writeOutput(output, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);

    // Write checkpoint JSON with empty semantic fields (lite = no LLM)
    const deterministicState = await gatherDeterministicState(cwd);
    const checkpoint = HandoffCheckpointSchema.parse(deterministicState);
    const jsonPath = resolveCheckpointPath(cwd, options.out);
    if (jsonPath) {
      writeCheckpoint(jsonPath, checkpoint);
      log.dim(TAG, `Checkpoint: ${jsonPath}`);
    }

    log.dim(TAG, 'Lite handoff complete (zero LLM).');
    return;
  }

  // Resolve system prompt (allow .totem/prompts/handoff.md override)
  const systemPrompt = getSystemPrompt('handoff', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(branch, status, diff, diffStat, lessons, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);

    // Build structured checkpoint: deterministic state + semantic fields from LLM output
    const deterministicState = await gatherDeterministicState(cwd);
    const semanticFields = parseSemanticFields(content);
    const merged = { ...deterministicState, ...semanticFields };

    try {
      const checkpoint = HandoffCheckpointSchema.parse(merged);
      const jsonPath = resolveCheckpointPath(cwd, options.out);
      if (jsonPath) {
        writeCheckpoint(jsonPath, checkpoint);
        log.dim(TAG, `Checkpoint: ${jsonPath}`);
      }
    } catch (err) {
      // Checkpoint is best-effort — never block the handoff on validation failure
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `Checkpoint validation failed (skipped): ${msg}`);
    }
  }
}
