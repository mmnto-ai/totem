import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { extractChangedFiles, getGitDiff } from '../git.js';
import {
  formatResults,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Shield';
const MAX_DIFF_CHARS = 50_000;
const QUERY_DIFF_TRUNCATE = 2_000;
const MAX_SPEC_RESULTS = 3;
const MAX_SESSION_RESULTS = 5;
const MAX_CODE_RESULTS = 5;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Shield System Prompt — Pre-Flight Code Review

## Purpose
Perform a pre-flight code review on a git diff, using project-specific knowledge to catch traps and anti-patterns before a PR is opened.

## Role
You are a senior code reviewer analyzing a diff against the project's accumulated knowledge: past session lessons, architectural specs, and codebase conventions. Flag issues the developer might miss, especially ones that have caused problems before.

## Rules
- Focus on the DIFF — only comment on code that is actually changing
- Reference specific lines/hunks from the diff when flagging issues
- Cite Totem knowledge when it directly applies (e.g., "Session #142 found that...")
- Distinguish severity: CRITICAL (must fix), WARNING (should fix), INFO (consider)
- Be concise — this is a pre-flight check, not a full RFC
- If the diff looks clean and follows all known patterns, say so

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Summary
[1-2 sentences describing what this diff does at a high level]

### Critical Issues
[Issues that MUST be fixed before merging. If none, say "None found."]

### Warnings
[Issues that SHOULD be addressed. Include pattern violations, potential regressions, and lessons from past sessions. If none, say "None found."]

### Suggestions
[Optional improvements and style notes. If none, say "None."]

### Relevant History
[Specific past traps, lessons, or decisions from Totem knowledge that apply to this diff. If none, say "No relevant history found."]
`;

// ─── LanceDB retrieval ─────────────────────────────────

interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  code: SearchResult[];
}

async function retrieveContext(query: string, store: LanceStore): Promise<RetrievedContext> {
  const search = (typeFilter: ContentType, maxResults: number) =>
    store.search({ query, typeFilter, maxResults });

  const [specs, sessions, code] = await Promise.all([
    search('spec', MAX_SPEC_RESULTS),
    search('session_log', MAX_SESSION_RESULTS),
    search('code', MAX_CODE_RESULTS),
  ]);

  return { specs, sessions, code };
}

function buildSearchQuery(changedFiles: string[], diff: string): string {
  const fileNames = changedFiles.map((f) => path.basename(f)).join(' ');
  const diffSnippet = diff.slice(0, QUERY_DIFF_TRUNCATE);
  return `${fileNames} ${diffSnippet}`.trim();
}

// ─── Prompt assembly ────────────────────────────────────

function assemblePrompt(diff: string, changedFiles: string[], context: RetrievedContext): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // Diff section
  sections.push('=== DIFF ===');
  sections.push(`Changed files: ${changedFiles.join(', ')}`);
  sections.push('');
  if (diff.length > MAX_DIFF_CHARS) {
    sections.push(diff.slice(0, MAX_DIFF_CHARS));
    sections.push(`\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`);
  } else {
    sections.push(diff);
  }

  // Totem knowledge
  const specSection = formatResults(context.specs, 'RELATED SPECS & ADRs');
  const sessionSection = formatResults(context.sessions, 'RELATED SESSION HISTORY & LESSONS');
  const codeSection = formatResults(context.code, 'RELATED CODE PATTERNS');

  if (specSection || sessionSection || codeSection) {
    sections.push('\n=== TOTEM KNOWLEDGE ===');
    if (specSection) sections.push(specSection);
    if (sessionSection) sections.push(sessionSection);
    if (codeSection) sections.push(codeSection);
  }

  return sections.join('\n');
}

// ─── Main command ───────────────────────────────────────

export interface ShieldOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  staged?: boolean;
}

export async function shieldCommand(options: ShieldOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff
  const mode = options.staged ? 'staged' : 'all';
  console.error(`[${TAG}] Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  const diff = getGitDiff(mode, cwd);

  if (!diff.trim()) {
    console.error(`[${TAG}] No changes detected. Nothing to review.`);
    return;
  }

  const changedFiles = extractChangedFiles(diff);
  console.error(`[${TAG}] Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  // Connect to LanceDB
  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = buildSearchQuery(changedFiles, diff);
  console.error(`[${TAG}] Querying Totem index...`);
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length + context.code.length;
  console.error(
    `[${TAG}] Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code chunks`,
  );

  // Assemble prompt
  const prompt = assemblePrompt(diff, changedFiles, context);
  console.error(`[${TAG}] Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
}
