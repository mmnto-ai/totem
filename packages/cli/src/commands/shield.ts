import { execFileSync, execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { loadConfig, loadEnv, resolveConfigPath } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Shield';
const LLM_TIMEOUT_MS = 180_000;
const TEMP_ID_BYTES = 4;
const MAX_DIFF_CHARS = 50_000;
const QUERY_DIFF_TRUNCATE = 2_000;
// execFileSync on Windows can't resolve executables without shell
const IS_WIN = process.platform === 'win32';
const MODEL_NAME_RE = /^[\w./:_-]+$/;

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

// ─── Git helpers ────────────────────────────────────────

function getGitDiff(mode: 'staged' | 'all', cwd: string): string {
  const args = mode === 'staged' ? ['diff', '--staged'] : ['diff', 'HEAD'];
  try {
    const result = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 15_000,
      shell: IS_WIN,
    });
    return result;
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

function extractChangedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      // Format: diff --git a/path/to/file b/path/to/file
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      if (match) files.push(match[1]);
    }
  }
  return files;
}

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
    search('spec', 3),
    search('session_log', 5),
    search('code', 5),
  ]);

  return { specs, sessions, code };
}

function buildSearchQuery(changedFiles: string[], diff: string): string {
  const fileNames = changedFiles.map((f) => path.basename(f)).join(' ');
  const diffSnippet = diff.slice(0, QUERY_DIFF_TRUNCATE);
  return `${fileNames} ${diffSnippet}`.trim();
}

// ─── Prompt assembly ────────────────────────────────────

function formatResults(results: SearchResult[], heading: string): string {
  if (results.length === 0) return '';
  const items = results
    .map(
      (r) =>
        `- **${r.label}** (${r.filePath}, score: ${r.score.toFixed(3)})\n  ${r.content.slice(0, 300).replace(/\n/g, '\n  ')}`,
    )
    .join('\n\n');
  return `\n=== ${heading} ===\n${items}\n`;
}

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

// ─── Shell orchestrator ─────────────────────────────────

function invokeShellOrchestrator(
  prompt: string,
  command: string,
  model: string,
  cwd: string,
): string {
  const tmpName = `totem-shield-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
  const tempPath = path.join(os.tmpdir(), tmpName);

  try {
    fs.writeFileSync(tempPath, prompt, { encoding: 'utf-8', mode: 0o600 });

    const resolvedCmd = command.replace(/\{file\}/g, tempPath).replace(/\{model\}/g, model);

    console.error(`[${TAG}] Invoking orchestrator (this may take 15-60 seconds)...`);

    const result = execSync(resolvedCmd, {
      cwd,
      encoding: 'utf-8',
      timeout: LLM_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    return result.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[Totem Error] Shell orchestrator command failed: ${msg}`);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp cleanup is best-effort
    }
  }
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

  // --raw mode: output context only
  if (options.raw) {
    writeOutput(prompt, options.out);
    console.error(`[${TAG}] Raw context output complete (${totalResults} chunks).`);
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

  const result = invokeShellOrchestrator(prompt, config.orchestrator.command, model, cwd);
  writeOutput(result, options.out);

  if (options.out) {
    console.error(`[${TAG}] Shield review written to ${options.out}`);
  }
}

// ─── Output helpers ─────────────────────────────────────

function writeOutput(content: string, outPath?: string): void {
  if (outPath) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outPath, content, 'utf-8');
  } else {
    console.log(content);
  }
}
