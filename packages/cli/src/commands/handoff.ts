import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  invokeShellOrchestrator,
  loadConfig,
  loadEnv,
  MODEL_NAME_RE,
  resolveConfigPath,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Handoff';
const MAX_DIFF_CHARS = 50_000;
const LESSONS_TAIL_LINES = 100;
// execFileSync on Windows can't resolve executables without shell
const IS_WIN = process.platform === 'win32';

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

// ─── Git helpers ────────────────────────────────────────

function getGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf-8',
      shell: IS_WIN,
    }).trim();
  } catch {
    return '(unknown)';
  }
}

function getGitStatus(cwd: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

function getGitDiff(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 15_000,
      shell: IS_WIN,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        `[Totem Error] 'git' command not found. Ensure Git is installed and in your PATH.`,
      );
    }
    throw new Error(`[Totem Error] Failed to get git diff: ${msg}`);
  }
}

function getGitDiffStat(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD', '--stat'], {
      cwd,
      encoding: 'utf-8',
      timeout: 15_000,
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

// ─── Lessons file reader ────────────────────────────────

function readRecentLessons(cwd: string, totemDir: string): string {
  const lessonsPath = path.join(cwd, totemDir, 'lessons.md');
  if (!fs.existsSync(lessonsPath)) return '';

  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const lines = content.split('\n');

  if (lines.length <= LESSONS_TAIL_LINES) return content.trim();

  return lines.slice(-LESSONS_TAIL_LINES).join('\n').trim();
}

// ─── Prompt assembly ────────────────────────────────────

function assemblePrompt(
  branch: string,
  status: string,
  diff: string,
  diffStat: string,
  lessons: string,
): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // Git state
  sections.push('=== GIT STATE ===');
  sections.push(`Branch: ${branch}`);
  sections.push(`Status:\n${status || '(clean working tree)'}`);

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
      sections.push(diff.slice(0, MAX_DIFF_CHARS));
      sections.push(`\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`);
    } else {
      sections.push(diff);
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
}

export async function handoffCommand(options: HandoffOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Gather git state
  console.error(`[${TAG}] Gathering git state...`);
  const branch = getGitBranch(cwd);
  const status = getGitStatus(cwd);
  console.error(`[${TAG}] Branch: ${branch}`);

  // Get diff
  console.error(`[${TAG}] Getting uncommitted diff...`);
  const diff = getGitDiff(cwd);
  const diffStat = diff.trim() ? getGitDiffStat(cwd) : '';

  if (diff.trim()) {
    console.error(`[${TAG}] Diff: ${(diff.length / 1024).toFixed(0)}KB`);
  } else {
    console.error(`[${TAG}] Working tree is clean.`);
  }

  // Read recent lessons
  console.error(`[${TAG}] Reading recent lessons...`);
  const lessons = readRecentLessons(cwd, config.totemDir);
  console.error(
    `[${TAG}] Lessons: ${lessons ? `${lessons.split('\n').length} lines` : 'none found'}`,
  );

  // Assemble prompt
  const prompt = assemblePrompt(branch, status, diff, diffStat, lessons);
  console.error(`[${TAG}] Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  // --raw mode: output context only
  if (options.raw) {
    writeOutput(prompt, options.out);
    console.error(`[${TAG}] Raw context output complete.`);
    return;
  }

  // Require orchestrator for LLM synthesis
  if (!config.orchestrator) {
    throw new Error(
      `[Totem Error] No orchestrator configured. Add an 'orchestrator' block to totem.config.ts.\n` +
        `Example:\n  orchestrator: {\n    provider: 'shell',\n    command: 'gemini --model {model} --file {file}',\n    defaultModel: 'gemini-2.5-pro',\n  }`,
    );
  }

  if (config.orchestrator.provider !== 'shell') {
    throw new Error(
      `[Totem Error] Unsupported orchestrator provider: '${config.orchestrator.provider}'. Only 'shell' is supported.`,
    );
  }

  const model = options.model ?? config.orchestrator.defaultModel;
  if (!model) {
    throw new Error(
      `[Totem Error] No model specified. Provide one with --model or set 'defaultModel' in your orchestrator config.`,
    );
  }
  if (model.startsWith('-') || !MODEL_NAME_RE.test(model)) {
    throw new Error(
      `[Totem Error] Invalid model name '${model}'. Model names may not start with a hyphen and may only contain word characters, dots, slashes, colons, underscores, and hyphens.`,
    );
  }
  console.error(`[${TAG}] Model: ${model}`);

  const result = invokeShellOrchestrator(
    prompt,
    config.orchestrator.command,
    model,
    cwd,
    TAG,
    config.totemDir,
  );
  writeOutput(result, options.out);

  if (options.out) {
    console.error(`[${TAG}] Handoff written to ${options.out}`);
  }
}
