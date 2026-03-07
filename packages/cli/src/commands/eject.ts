import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { log } from '../ui.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Eject';
const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
const TOTEM_FILE_MARKER = '// [totem] auto-generated';

/** Files that may have AI reflex blocks appended by `totem init`. */
const REFLEX_FILES = ['CLAUDE.md', '.cursorrules'];

/** Files scaffolded by `totem init` that are fully owned by Totem. */
const TOTEM_SCAFFOLDED_FILES = [
  '.gemini/hooks/SessionStart.js',
  '.gemini/hooks/BeforeTool.js',
  '.gemini/skills/totem.md',
  '.totem/hooks/shield-gate.cjs',
];

// ─── Helpers ────────────────────────────────────────────

interface EjectSummary {
  removed: string[];
  scrubbed: string[];
  skipped: string[];
}

/**
 * Remove the Totem section from the post-merge git hook.
 * Deletes the file entirely if it only contains the Totem hook.
 */
function scrubPostMergeHook(cwd: string, summary: EjectSummary): void {
  const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
  if (!fs.existsSync(hookPath)) {
    summary.skipped.push('.git/hooks/post-merge (not found)');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes(TOTEM_HOOK_MARKER)) {
    summary.skipped.push('.git/hooks/post-merge (no Totem section)');
    return;
  }

  // Remove the Totem block: from the marker comment to the background command
  const lines = content.split('\n');
  const filtered: string[] = [];
  let inTotemBlock = false;

  for (const line of lines) {
    if (line.includes(TOTEM_HOOK_MARKER)) {
      inTotemBlock = true;
      continue;
    }
    if (inTotemBlock) {
      // Skip lines until we hit a blank line or non-Totem content
      if (
        line === '' ||
        line.startsWith('echo "[totem]') ||
        line.startsWith('(') ||
        line.trim() === ''
      ) {
        continue;
      }
      inTotemBlock = false;
    }
    filtered.push(line);
  }

  const remaining = filtered.join('\n').trim();

  if (!remaining || remaining === '#!/bin/sh') {
    fs.unlinkSync(hookPath);
    summary.removed.push('.git/hooks/post-merge');
  } else {
    fs.writeFileSync(hookPath, remaining + '\n', 'utf-8');
    summary.scrubbed.push('.git/hooks/post-merge');
  }
}

/**
 * Remove scaffolded files that are fully owned by Totem.
 * Only removes files that contain the Totem marker to avoid deleting user files.
 */
function removeScaffoldedFiles(cwd: string, summary: EjectSummary): void {
  for (const rel of TOTEM_SCAFFOLDED_FILES) {
    const filePath = path.join(cwd, rel);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes(TOTEM_FILE_MARKER) || content.includes('[totem] auto-generated')) {
      fs.unlinkSync(filePath);
      summary.removed.push(rel);
    } else {
      summary.skipped.push(`${rel} (no Totem marker)`);
    }
  }
}

/**
 * Remove the Totem PreToolUse hook entry from Claude's settings.local.json.
 */
function scrubClaudeSettings(cwd: string, summary: EjectSummary): void {
  const filePath = path.join(cwd, '.claude', 'settings.local.json');
  if (!fs.existsSync(filePath)) {
    summary.skipped.push('.claude/settings.local.json (not found)');
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    summary.skipped.push('.claude/settings.local.json (invalid JSON)');
    return;
  }

  const hooks = parsed.hooks as Record<string, unknown[]> | undefined;
  const preToolUse = hooks?.PreToolUse as
    | Array<{ matcher?: string; hooks?: Array<unknown> }>
    | undefined;
  if (!preToolUse) {
    summary.skipped.push('.claude/settings.local.json (no PreToolUse hooks)');
    return;
  }

  const filtered = preToolUse.filter((entry) => {
    if (entry.matcher !== 'Bash') return true;
    const entryHooks = entry.hooks ?? [];
    return !entryHooks.some((h) => {
      const cmd =
        typeof h === 'string'
          ? h
          : h && typeof h === 'object'
            ? ((h as { command?: string }).command ?? '')
            : '';
      return cmd.includes('shield-gate') || cmd.includes('totem shield');
    });
  });

  if (filtered.length === preToolUse.length) {
    summary.skipped.push('.claude/settings.local.json (no Totem hooks)');
    return;
  }

  hooks!.PreToolUse = filtered;
  if (filtered.length === 0) {
    delete hooks!.PreToolUse;
  }
  // Clean up empty hooks object
  if (Object.keys(hooks!).length === 0) {
    delete parsed.hooks;
  }

  if (Object.keys(parsed).length === 0) {
    fs.unlinkSync(filePath);
    summary.removed.push('.claude/settings.local.json');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    summary.scrubbed.push('.claude/settings.local.json');
  }
}

/**
 * Remove the AI Integration block appended by `totem init` to reflex files.
 */
function scrubReflexFiles(cwd: string, summary: EjectSummary): void {
  for (const rel of REFLEX_FILES) {
    const filePath = path.join(cwd, rel);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    // Match the block from the heading to end of file (init always appends at the end)
    const primaryMarker = /\n*## Totem AI Integration \(Auto-Generated\)[\s\S]*$/;
    const altMarker = /\n*## Totem Memory Reflexes[\s\S]*$/;
    const activeMarker = primaryMarker.test(content)
      ? primaryMarker
      : altMarker.test(content)
        ? altMarker
        : null;

    if (!activeMarker) {
      summary.skipped.push(`${rel} (no Totem block)`);
      continue;
    }

    fs.writeFileSync(filePath, content.replace(activeMarker, '\n'), 'utf-8');
    summary.scrubbed.push(rel);
  }
}

/**
 * Delete Totem directories and config file.
 */
function deleteArtifacts(cwd: string, summary: EjectSummary): void {
  const artifacts = ['.lancedb', '.totem'];
  for (const dir of artifacts) {
    const dirPath = path.join(cwd, dir);
    if (fs.existsSync(dirPath)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        summary.removed.push(`${dir}/`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.skipped.push(`${dir}/ (could not delete: ${msg})`);
      }
    } else {
      summary.skipped.push(`${dir}/ (not found)`);
    }
  }

  const configPath = path.join(cwd, 'totem.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
      summary.removed.push('totem.config.ts');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.skipped.push(`totem.config.ts (could not delete: ${msg})`);
    }
  } else {
    summary.skipped.push('totem.config.ts (not found)');
  }
}

// ─── Main command ───────────────────────────────────────

export interface EjectOptions {
  force?: boolean;
}

export async function ejectCommand(options: EjectOptions): Promise<void> {
  const cwd = process.cwd();

  if (!options.force) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        'This will remove all Totem hooks, config, and data from this project. Continue? (y/N): ',
      );
      if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
        log.info(TAG, 'Aborted.');
        return;
      }
    } finally {
      rl.close();
    }
  }

  const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };

  // 1. Scrub git hooks
  scrubPostMergeHook(cwd, summary);

  // 2. Remove scaffolded Gemini/Claude hook files
  removeScaffoldedFiles(cwd, summary);

  // 3. Scrub Claude settings.local.json
  scrubClaudeSettings(cwd, summary);

  // 4. Scrub AI reflex blocks from markdown files
  scrubReflexFiles(cwd, summary);

  // 5. Delete artifacts
  deleteArtifacts(cwd, summary);

  // Print summary
  if (summary.removed.length > 0) {
    log.info(TAG, 'Removed:');
    for (const item of summary.removed) {
      log.success(TAG, `  ${item}`);
    }
  }
  if (summary.scrubbed.length > 0) {
    log.info(TAG, 'Scrubbed (Totem content removed, file preserved):');
    for (const item of summary.scrubbed) {
      log.success(TAG, `  ${item}`);
    }
  }
  if (summary.skipped.length > 0) {
    log.dim(TAG, 'Skipped:');
    for (const item of summary.skipped) {
      log.dim(TAG, `  ${item}`);
    }
  }
  if (summary.removed.length === 0 && summary.scrubbed.length === 0) {
    log.info(TAG, 'Nothing to remove — project appears clean.');
  }

  log.success(TAG, 'Totem has been ejected from this project.');
}
