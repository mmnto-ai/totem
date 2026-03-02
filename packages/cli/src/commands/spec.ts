import { execFileSync, execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { loadConfig, loadEnv, resolveConfigPath } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Spec';
const GH_TIMEOUT_MS = 15_000;
const LLM_TIMEOUT_MS = 180_000;
const TEMP_ID_BYTES = 4;
const QUERY_BODY_TRUNCATE = 500;
const IS_WIN = process.platform === 'win32';

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Spec System Prompt — Pre-Work Briefing

## Purpose
Produce a structured pre-work briefing for a GitHub issue before implementation begins.

## Role
You are a technical spec writer analyzing a GitHub issue and its related project context. Your job is to produce a focused briefing that identifies: relevant history, files to examine, implementation approach, traps, and test plan.

## Rules
- File paths must reference actual files from the context provided
- Cite related issues by number (#NNN) when relevant
- Identify edge cases the issue description doesn't mention
- Be concise — this is a briefing, not a full proposal
- When multiple approaches exist, list trade-offs with a clear recommendation

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Problem
[1-2 sentences restating the issue in concrete implementation terms. What exactly needs to change?]

### Historical Context
[Relevant sessions, PRs, decisions, related issues from the provided Totem knowledge. If nothing relevant, say "None found in provided context."]

### Files to Examine
[Ordered list of files the developer should read before starting. Most critical first. Format: \`path/to/file.ts\` — reason to examine]

### Approach
[Recommended implementation approach. Concrete steps, not abstract descriptions. If multiple valid approaches exist, list them as Option A / Option B with trade-offs and a clear recommendation.]

### Edge Cases & Traps
[Things the issue description doesn't mention but the developer should watch for. Include existing patterns that MUST be followed for consistency and potential regressions in related features.]

### Test Plan
[Specific test scenarios. Reference existing test file patterns when applicable.]

### Related Issues
[Issues that might be affected by or related to this work. Format: #NNN — title — relationship (blocks, unblocks, overlaps, conflicts). If none found, say "None identified."]
`;

// ─── GitHub helpers ─────────────────────────────────────

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  state: string;
}

function fetchIssue(issueNumber: number, cwd: string): GhIssue {
  try {
    const result = execFileSync(
      'gh',
      ['issue', 'view', String(issueNumber), '--json', 'number,title,body,labels,state'],
      { cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS, shell: IS_WIN },
    );
    return JSON.parse(result) as GhIssue;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        `[Totem Error] GitHub CLI (gh) is required for issue fetching. Install: https://cli.github.com`,
      );
    }
    throw new Error(`[Totem Error] Failed to fetch issue #${issueNumber}: ${msg}`);
  }
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
    search('spec', 5),
    search('session_log', 5),
    search('code', 3),
  ]);

  return { specs, sessions, code };
}

function buildSearchQuery(issue: GhIssue): string {
  const labels = issue.labels.map((l) => l.name).join(' ');
  const bodySnippet = (issue.body ?? '').slice(0, QUERY_BODY_TRUNCATE);
  return `${issue.title} ${labels} ${bodySnippet}`.trim();
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

function assemblePrompt(
  issue: GhIssue | null,
  freeText: string | null,
  context: RetrievedContext,
): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // Target issue or free-text topic
  if (issue) {
    const issueLabels = issue.labels.map((l) => l.name).join(', ');
    sections.push('=== TARGET ISSUE ===');
    sections.push(`Issue #${issue.number}: ${issue.title}`);
    sections.push(`Labels: ${issueLabels || '(none)'}`);
    sections.push(`State: ${issue.state}`);
    if (issue.body) {
      sections.push('');
      sections.push(issue.body);
    }
  } else if (freeText) {
    sections.push('=== TOPIC ===');
    sections.push(freeText);
  }

  // Totem knowledge
  const specSection = formatResults(context.specs, 'RELATED SPECS & ADRs');
  const sessionSection = formatResults(context.sessions, 'RELATED SESSION HISTORY');
  const codeSection = formatResults(context.code, 'RELATED CODE');

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
  const tmpName = `totem-spec-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
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
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp cleanup is best-effort
    }
  }
}

// ─── Main command ───────────────────────────────────────

export interface SpecOptions {
  raw?: boolean;
  out?: string;
  model?: string;
}

export async function specCommand(input: string, options: SpecOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Connect to LanceDB
  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Parse input: issue number or free-text
  const issueNumber = /^\d+$/.test(input) ? parseInt(input, 10) : null;
  let issue: GhIssue | null = null;
  let query: string;

  if (issueNumber) {
    console.error(`[${TAG}] Fetching issue #${issueNumber}...`);
    issue = fetchIssue(issueNumber, cwd);
    console.error(`[${TAG}] Title: ${issue.title}`);
    query = buildSearchQuery(issue);
  } else {
    console.error(`[${TAG}] Topic: ${input}`);
    query = input;
  }

  // Retrieve context from LanceDB
  console.error(`[${TAG}] Querying Totem index...`);
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length + context.code.length;
  console.error(
    `[${TAG}] Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code chunks`,
  );

  // Assemble prompt
  const prompt = assemblePrompt(issue, issueNumber ? null : input, context);
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

  const model = options.model ?? config.orchestrator.defaultModel ?? 'default';
  console.error(`[${TAG}] Model: ${model}`);

  const result = invokeShellOrchestrator(prompt, config.orchestrator.command, model, cwd);
  writeOutput(result, options.out);

  if (options.out) {
    console.error(`[${TAG}] Spec written to ${options.out}`);
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
