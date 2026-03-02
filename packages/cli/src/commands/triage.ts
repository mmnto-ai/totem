import { execFileSync, execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { z } from 'zod';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { loadConfig, loadEnv, resolveConfigPath } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Triage';
const GH_TIMEOUT_MS = 15_000;
const LLM_TIMEOUT_MS = 180_000;
const TEMP_ID_BYTES = 4;
const MAX_SPEC_RESULTS = 5;
const MAX_SESSION_RESULTS = 5;
const QUERY_TITLES_TRUNCATE = 2_000;
const GH_ISSUE_LIMIT = 100;
// execFileSync on Windows can't resolve executables without shell
const IS_WIN = process.platform === 'win32';
const MODEL_NAME_RE = /^[\w./:_-]+$/;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Triage System Prompt — Active Work Roadmap

## Purpose
Produce a prioritized roadmap from the project's open GitHub issues, informed by recent work history from Totem knowledge.

## Role
You are a technical project manager analyzing a project's open issue backlog alongside its recent development history. Your job is to produce a clear, actionable prioritization that helps the developer decide what to work on next.

## Rules
- Reference issues by number (#NNN) and title
- Consider labels (bug, enhancement, priority, etc.) as strong signals
- Use recent session history and specs to understand project momentum — what was just finished, what's in progress
- Factor in issue age (updatedAt) — stale issues may need re-evaluation
- Be opinionated — give a clear recommendation, not a wishy-washy list
- Be concise — this is a decision-making tool, not a project plan

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Active Work Summary
[1-3 sentences about what was recently completed or is in progress, based on the Totem knowledge provided. If no relevant history, say "No recent session history available."]

### Prioritized Roadmap
[Ordered list of open issues, most important first. For each: #NNN — title — 1-sentence rationale for its priority position. Group by priority tier if helpful (e.g., "Do Next", "Up Next", "Backlog").]

### Next Issue
[Single recommended issue to work on next. Include: issue number, title, and 2-3 sentences explaining WHY this should be next — considering dependencies, momentum, and impact.]

### Blocked / Needs Input
[Issues that cannot progress without external input, decisions, or prerequisite work. If none, say "None identified."]
`;

// ─── GitHub helpers ─────────────────────────────────────

const GhIssueListItemSchema = z.object({
  number: z.number(),
  title: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  updatedAt: z.string().datetime(),
});
type GhIssueListItem = z.infer<typeof GhIssueListItemSchema>;

function fetchOpenIssues(cwd: string): GhIssueListItem[] {
  try {
    const result = execFileSync(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--json',
        'number,title,labels,updatedAt',
        '--limit',
        String(GH_ISSUE_LIMIT),
      ],
      { cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS, shell: IS_WIN },
    );
    return z.array(GhIssueListItemSchema).parse(JSON.parse(result));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`[Totem Error] Failed to parse GitHub issue list response: ${err.message}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        `[Totem Error] GitHub CLI (gh) is required for issue fetching. Install: https://cli.github.com`,
      );
    }
    throw new Error(`[Totem Error] Failed to fetch open issues: ${msg}`);
  }
}

// ─── LanceDB retrieval ─────────────────────────────────

interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
}

async function retrieveContext(query: string, store: LanceStore): Promise<RetrievedContext> {
  const search = (typeFilter: ContentType, maxResults: number) =>
    store.search({ query, typeFilter, maxResults });

  const [specs, sessions] = await Promise.all([
    search('spec', MAX_SPEC_RESULTS),
    search('session_log', MAX_SESSION_RESULTS),
  ]);

  return { specs, sessions };
}

function buildSearchQuery(issues: GhIssueListItem[]): string {
  const titles = issues.map((i) => i.title).join(' ');
  const labels = [...new Set(issues.flatMap((i) => i.labels.map((l) => l.name)))].join(' ');
  return `${titles} ${labels}`.slice(0, QUERY_TITLES_TRUNCATE).trim();
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

function formatIssueInventory(issues: GhIssueListItem[]): string {
  const rows = issues.map((i) => {
    const labels = i.labels.map((l) => l.name).join(', ') || '(none)';
    const updated = i.updatedAt.slice(0, 10); // YYYY-MM-DD
    return `| #${i.number} | ${i.title} | ${labels} | ${updated} |`;
  });

  return ['| Issue | Title | Labels | Updated |', '|---|---|---|---|', ...rows].join('\n');
}

function assemblePrompt(issues: GhIssueListItem[], context: RetrievedContext): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // Issue inventory
  sections.push('=== OPEN ISSUES ===');
  sections.push(`Total: ${issues.length} open issues\n`);
  sections.push(formatIssueInventory(issues));

  // Totem knowledge
  const specSection = formatResults(context.specs, 'RECENT SPECS & ADRs');
  const sessionSection = formatResults(context.sessions, 'RECENT SESSION HISTORY');

  if (specSection || sessionSection) {
    sections.push('\n=== TOTEM KNOWLEDGE ===');
    if (specSection) sections.push(specSection);
    if (sessionSection) sections.push(sessionSection);
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
  const tmpName = `totem-triage-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
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

export interface TriageOptions {
  raw?: boolean;
  out?: string;
  model?: string;
}

export async function triageCommand(options: TriageOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Fetch open issues
  console.error(`[${TAG}] Fetching open issues...`);
  const issues = fetchOpenIssues(cwd);

  if (issues.length === 0) {
    console.error(`[${TAG}] No open issues found. Nothing to triage.`);
    return;
  }

  console.error(`[${TAG}] Found ${issues.length} open issues.`);

  // Connect to LanceDB
  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = buildSearchQuery(issues);
  console.error(`[${TAG}] Querying Totem index...`);
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length;
  console.error(
    `[${TAG}] Found: ${context.specs.length} specs, ${context.sessions.length} sessions`,
  );

  // Assemble prompt
  const prompt = assemblePrompt(issues, context);
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
    console.error(`[${TAG}] Roadmap written to ${options.out}`);
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
