import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DocTarget } from '@mmnto/totem';

import { GitHubCliAdapter } from '../adapters/github-cli.js';
import { getGitLogSince, getLatestTag, isFileDirty } from '../git.js';
import { log } from '../ui.js';
import {
  getSystemPrompt,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Docs';
const MAX_DOC_CHARS = 80_000;
const MAX_LOG_CHARS = 20_000;
const GH_CLOSED_ISSUE_LIMIT = 50;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Docs System Prompt — Automated Documentation Sync

## Identity & Role
You are a meticulous Technical Writer responsible for keeping project documentation accurate and up-to-date. You rewrite documentation files to reflect the latest project state.

## Core Mission
Given a documentation file, its purpose, and recent project changes (git log, closed issues), produce an updated version of the entire file that accurately reflects the current state.

## Critical Rules
- **Full Rewrite:** Output the ENTIRE updated file content — not a diff, not a patch, the complete file.
- **Preserve Structure:** Maintain the existing document's structure, tone, and formatting conventions unless changes require restructuring.
- **Evidence-Based:** Only update information that is supported by the provided git log, closed issues, or active work context. Do NOT invent features or status changes.
- **Phase Numbering:** If the document references phases, use ONLY the phase numbering from the provided active_work.md context. Do NOT change or renumber phases.
- **Conservative Updates:** When in doubt, keep the existing text. Only change what the evidence supports.
- **No Preamble:** Output ONLY the updated file content. No commentary, no explanation, no markdown code fences wrapping the output.
`;

// ─── Release context gathering ──────────────────────────

interface ReleaseContext {
  tag: string | null;
  gitLog: string;
  closedIssues: string;
}

function gatherReleaseContext(cwd: string): ReleaseContext {
  const tag = getLatestTag(cwd);
  const gitLog = getGitLogSince(cwd, tag ?? undefined);

  let closedIssues = '';
  try {
    const adapter = new GitHubCliAdapter(cwd);
    const issues = adapter.fetchClosedIssues(GH_CLOSED_ISSUE_LIMIT, tag ?? undefined);
    if (issues.length > 0) {
      closedIssues = issues
        .map((i) => `#${i.number} — ${i.title} (closed ${i.closedAt?.slice(0, 10) ?? 'unknown'})`)
        .join('\n');
    }
  } catch {
    log.dim(TAG, 'Could not fetch closed issues (gh CLI unavailable or no remote).');
  }

  return { tag, gitLog, closedIssues };
}

// ─── Prompt assembly ────────────────────────────────────

function assemblePrompt(
  doc: DocTarget,
  currentContent: string,
  releaseContext: ReleaseContext,
  activeWork: string,
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  // Document metadata
  sections.push('=== DOCUMENT TO UPDATE ===');
  sections.push(`Path: ${doc.path}`);
  sections.push(`Purpose: ${doc.description}`);
  sections.push('');

  // Current content
  const truncatedContent =
    currentContent.length > MAX_DOC_CHARS
      ? currentContent.slice(0, MAX_DOC_CHARS) + '\n... [truncated] ...'
      : currentContent;
  sections.push(wrapXml('current_document', truncatedContent));

  // Release context
  sections.push('\n=== CHANGES SINCE LAST RELEASE ===');
  if (releaseContext.tag) {
    sections.push(`Last release tag: ${releaseContext.tag}`);
  } else {
    sections.push('No release tags found — showing recent commits.');
  }

  if (releaseContext.gitLog) {
    const truncatedLog =
      releaseContext.gitLog.length > MAX_LOG_CHARS
        ? releaseContext.gitLog.slice(0, MAX_LOG_CHARS) + '\n... [truncated] ...'
        : releaseContext.gitLog;
    sections.push(wrapXml('git_log', truncatedLog));
  } else {
    sections.push('(No commits found since last release)');
  }

  if (releaseContext.closedIssues) {
    sections.push(wrapXml('closed_issues', releaseContext.closedIssues));
  }

  // Active work context
  if (activeWork) {
    sections.push('\n=== ACTIVE WORK (SOURCE OF TRUTH FOR PHASES & PRIORITIES) ===');
    sections.push(wrapXml('active_work', activeWork));
  }

  return sections.join('\n');
}

// ─── Diff display ───────────────────────────────────────

function showDiff(filePath: string, original: string, updated: string): boolean {
  if (original === updated) {
    log.dim(TAG, `No changes for ${filePath}.`);
    return false;
  }

  const originalLines = original.split('\n');
  const updatedLines = updated.split('\n');

  let added = 0;
  let removed = 0;

  // Simple line-level diff summary
  const originalSet = new Set(originalLines);
  const updatedSet = new Set(updatedLines);

  for (const line of updatedLines) {
    if (!originalSet.has(line)) added++;
  }
  for (const line of originalLines) {
    if (!updatedSet.has(line)) removed++;
  }

  log.info(TAG, `${filePath}: +${added} / -${removed} lines changed`);
  return true;
}

// ─── Main command ───────────────────────────────────────

export interface DocsOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  only?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export async function docsCommand(options: DocsOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Validate docs are configured
  if (!config.docs || config.docs.length === 0) {
    const err = new Error(
      `[Totem Error] No docs configured.\n` +
        `Add a 'docs' array to totem.config.ts. Example:\n` +
        `  docs: [\n` +
        `    { path: 'README.md', description: 'Public-facing README', trigger: 'post-release' },\n` +
        `  ]`,
    );
    err.name = 'NoDocsConfiguredError';
    throw err;
  }

  // Filter by --only
  let targets = config.docs;
  if (options.only) {
    const onlyNames = options.only.split(',').map((s) => s.trim().toLowerCase());
    targets = config.docs.filter((d) => {
      const basename = path.basename(d.path, path.extname(d.path)).toLowerCase();
      const fullPath = d.path.toLowerCase();
      return onlyNames.some((name) => basename.includes(name) || fullPath.includes(name));
    });
    if (targets.length === 0) {
      throw new Error(
        `[Totem Error] --only '${options.only}' matched no configured docs.\n` +
          `Available: ${config.docs.map((d) => d.path).join(', ')}`,
      );
    }
  }

  log.info(TAG, `Updating ${targets.length} doc(s): ${targets.map((d) => d.path).join(', ')}`);

  // Check for dirty files (data loss protection)
  const dirtyFiles = targets.filter((d) => isFileDirty(cwd, d.path));
  if (dirtyFiles.length > 0 && !options.dryRun) {
    throw new Error(
      `[Totem Error] The following doc(s) have uncommitted changes:\n` +
        dirtyFiles.map((d) => `  - ${d.path}`).join('\n') +
        `\nCommit or stash changes before running \`totem docs\` to prevent data loss.`,
    );
  }

  // Gather release context (shared across all docs)
  log.info(TAG, 'Gathering release context...');
  const releaseContext = gatherReleaseContext(cwd);
  if (releaseContext.tag) {
    log.dim(TAG, `Last release: ${releaseContext.tag}`);
  }

  // Load active_work.md for phase/priority context
  let activeWork = '';
  const activeWorkPath = path.join(cwd, 'docs', 'active_work.md');
  try {
    activeWork = fs.readFileSync(activeWorkPath, 'utf-8');
  } catch {
    log.dim(TAG, 'No docs/active_work.md found — proceeding without active work context.');
  }

  // Resolve system prompt (allow .totem/prompts/docs.md override)
  const systemPrompt = getSystemPrompt('docs', SYSTEM_PROMPT, cwd, config.totemDir);

  // Process each doc sequentially (separate orchestrator call per doc)
  let updated = 0;
  let failed = 0;
  for (const doc of targets) {
    const filePath = path.join(cwd, doc.path);

    // Read current content
    let currentContent: string;
    try {
      currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      log.warn(TAG, `Skipping ${doc.path} — file not found.`);
      continue;
    }

    log.info(TAG, `Processing ${doc.path}...`);

    // Assemble prompt for this doc
    const prompt = assemblePrompt(doc, currentContent, releaseContext, activeWork, systemPrompt);
    log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

    let content: string | undefined;
    try {
      content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(TAG, `Failed to process ${doc.path} — skipping. ${msg}`);
      failed++;
      continue;
    }

    if (content == null) continue; // --raw mode

    // Check if anything changed
    const trimmedContent = content.trimEnd() + '\n';
    const hasChanges = showDiff(doc.path, currentContent, trimmedContent);
    if (!hasChanges) continue;

    if (options.dryRun) {
      log.dim(TAG, `[dry-run] Would update ${doc.path}`);
      if (options.out) {
        writeOutput(trimmedContent, options.out);
        log.success(TAG, `[dry-run] Preview written to ${options.out}`);
      }
      continue;
    }

    // Write the updated content
    fs.writeFileSync(filePath, trimmedContent, 'utf-8');
    log.success(TAG, `Updated ${doc.path}`);
    updated++;
  }

  if (updated > 0) {
    log.success(TAG, `Done — ${updated} doc(s) updated.`);
  } else if (!options.raw && !options.dryRun) {
    log.dim(TAG, 'No docs needed updating.');
  }

  if (failed > 0) {
    log.warn(TAG, `${failed} doc(s) failed to process. See errors above.`);
  }
}
