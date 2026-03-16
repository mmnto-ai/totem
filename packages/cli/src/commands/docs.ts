import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DocTarget, SagaViolation } from '@mmnto/totem';
import { validateDocUpdate } from '@mmnto/totem';

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

/**
 * Issues closed without shipping. The LLM hallucinates these as live
 * features because they appear in the git log. Strip before and after LLM.
 */
const CLOSED_NOT_SHIPPED = [515];

function stripNotShipped(text: string): string {
  let result = text;
  for (const n of CLOSED_NOT_SHIPPED) {
    result = result.replace(new RegExp(`\\s*\\(#${n}\\)`, 'g'), '');
  }
  return result;
}

// ─── System prompt ──────────────────────────────────────

export const DOCS_SYSTEM_PROMPT = `# Docs System Prompt — Automated Documentation Sync

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
- **Checkbox Integrity:** NEVER change the checked/unchecked state of markdown checkboxes (\`[x]\` / \`[ ]\`) unless the commit history explicitly contains a revert, deprecation, or re-opening of the referenced item. Priority rankings in active_work.md are NOT evidence of completion status.
- **XML Wrapper (MANDATORY):** Wrap your ENTIRE output inside \`<updated_document>\` and \`</updated_document>\` tags. No text before or after the tags. No markdown code fences. Example:

\`\`\`
<updated_document>
# My Document
Updated content here...
</updated_document>
\`\`\`

## Command Glossary (DO NOT confuse these)
- **\`totem lint\`**: Runs compiled AST/regex rules against a diff. Zero LLM. Fast (~2s). No API keys needed. Used in pre-push hooks and CI. Lives in the Lite configuration tier.
- **\`totem shield\`**: AI-powered code review. Queries LanceDB for context, sends diff + knowledge to an LLM. Slow (~18s). Requires API keys. Used before opening PRs. Lives in the Full configuration tier.
- These are DIFFERENT commands with DIFFERENT purposes. Never describe \`shield\` as "deterministic" or \`lint\` as "AI-powered."

## Formatting Rules
- **Sub-Bullet Threshold:** When a feature list exceeds 3 items, use nested sub-bullets instead of comma-separated inline lists. Group related items into named categories (e.g., "Security:", "DX:", "Orchestration:").
- **Completed Phase Summary:** Phases marked \`[x]\` should be summarized in 1-2 sentences max. Do NOT expand completed phases with every PR number — use categorized sub-bullets for the key capability areas only.
- **Line Length:** No single bullet point should exceed two short sentences. If it does, break it into sub-bullets or summarize. Readability is more important than completeness.
- **PR References:** Reference PR numbers sparingly — only for the most significant items (1-3 per sub-bullet). Do NOT list every PR number for a capability area.
`;

// ─── Release context gathering ──────────────────────────

interface ReleaseContext {
  tag: string | null;
  gitLog: string;
  closedIssues: string;
}

function gatherReleaseContext(cwd: string): ReleaseContext {
  const tag = getLatestTag(cwd);
  const gitLog = stripNotShipped(getGitLogSince(cwd, tag ?? undefined));

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

// ─── Response extraction ─────────────────────────────────

const UPDATED_DOC_RE = /^\s*<updated_document>\s*\n?([\s\S]*?)\n?\s*<\/updated_document>\s*$/;

/**
 * Extract the file content from the LLM's `<updated_document>` wrapper.
 * Returns null if the closing tag is missing (truncated or malformed response).
 */
export function extractUpdatedDocument(response: string): string | null {
  const match = UPDATED_DOC_RE.exec(response);
  return match ? match[1]! : null;
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

export async function docsCommand(inputs: string[], options: DocsOptions): Promise<void> {
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

  // Resolve targets from positional args, --only, or all docs
  let targets = config.docs;

  // Fail-fast: conflicting targeting flags
  if (inputs.length > 0 && options.only) {
    throw new Error(
      `[Totem Error] Cannot combine positional doc paths with --only flag.\n` +
        `Use one or the other: \`totem docs README.md\` OR \`totem docs --only readme\`.`,
    );
  }

  if (inputs.length > 0) {
    // Positional path targeting — fail-fast validation
    const normalize = (p: string) => path.relative(cwd, path.resolve(cwd, p)).replace(/\\/g, '/');
    const configPaths = new Map(config.docs.map((d) => [normalize(d.path), d]));

    const resolved = new Set<DocTarget>();
    const invalid: string[] = [];
    for (const input of inputs) {
      const normalized = normalize(input);
      const match = configPaths.get(normalized);
      if (match) {
        resolved.add(match);
      } else {
        invalid.push(input);
      }
    }

    if (invalid.length > 0) {
      throw new Error(
        `[Totem Error] Unknown doc path(s): ${invalid.join(', ')}\n` +
          `Available: ${config.docs.map((d) => d.path).join(', ')}`,
      );
    }
    targets = Array.from(resolved);
  } else if (options.only) {
    // Legacy --only filter
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
  const systemPrompt = getSystemPrompt('docs', DOCS_SYSTEM_PROMPT, cwd, config.totemDir);

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
      const msg = (err instanceof Error ? err.message : String(err)).replace(
        /^\s*\[Totem Error\]\s*/,
        '',
      );
      log.error(TAG, `Failed to process ${doc.path} — skipping. ${msg}`);
      failed++;
      continue;
    }

    if (content == null) continue; // --raw mode

    // Extract content from <updated_document> wrapper — structural integrity check
    const extracted = extractUpdatedDocument(content);
    if (extracted == null) {
      log.error(
        TAG,
        `Failed to process ${doc.path} — response missing <updated_document> wrapper (truncated or malformed). Skipping.`,
      );
      failed++;
      continue;
    }

    // Strip known hallucinated issue references from LLM output
    const cleaned = stripNotShipped(extracted);
    const trimmedContent = cleaned.trimEnd() + '\n';
    const hasChanges = showDiff(doc.path, currentContent, trimmedContent);
    if (!hasChanges) continue;

    // Saga checkpoint — validate before writing (#351)
    let violations: SagaViolation[];
    try {
      violations = validateDocUpdate(currentContent, trimmedContent);
    } catch (err) {
      log.warn(
        TAG,
        `${doc.path}: Saga validator threw unexpectedly — proceeding without validation. ${err instanceof Error ? err.message : String(err)}`,
      );
      violations = [];
    }
    if (violations.length > 0) {
      log.error(
        TAG,
        `${doc.path}: Saga validator rejected update (${violations.length} violation(s)):`,
      );
      for (const v of violations) {
        log.error(TAG, `  [${v.type}]${v.line ? ` line ${v.line}:` : ''} ${v.message}`);
      }
      log.warn(TAG, `${doc.path}: Original preserved — skipping.`);
      failed++;
      continue;
    }

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
