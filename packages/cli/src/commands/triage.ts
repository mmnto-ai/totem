import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import { z } from 'zod';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import {
  formatResults,
  GH_TIMEOUT_MS,
  IS_WIN,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Triage';
const MAX_SPEC_RESULTS = 5;
const MAX_SESSION_RESULTS = 5;
const QUERY_TITLES_TRUNCATE = 2_000;
const GH_ISSUE_LIMIT = 100;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Triage System Prompt — Active Work Roadmap

## Identity & Role
You are a strict, highly-focused Product Manager. Your sole purpose is to cut through the noise of an open issue backlog and produce an actionable roadmap. You do not write code. You do not solve technical problems. You prioritize, organize, and set scope boundaries.

## Core Mission
Produce a prioritized roadmap from the project's open GitHub issues, strictly informed by recent work momentum from the Totem knowledge base. Define what is being built next.

## Critical Rules
- **No Implementation:** Refuse to suggest code changes or technical solutions. Focus strictly on user stories, acceptance criteria, and priority.
- **Be Opinionated:** Give a single, clear recommendation for the next task. No wishy-washy lists.
- **Momentum:** Use recent session history to understand what was just finished and what is in progress.
- **Clarity:** Reference issues by number (#NNN) and title. Consider labels and issue age.

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Active Work Summary
[1-3 sentences about what was recently completed or is in progress, based on the Totem knowledge provided. If no relevant history, say "No recent session history available."]

### Prioritized Roadmap
[Ordered list of open issues, most important first. For each: #NNN — title — 1-sentence rationale for its priority position. Group by priority tier if helpful (e.g., "Do Next", "Up Next", "Backlog").]

### Next Issue (User Story & Scope)
[Single recommended issue to work on next. Include: issue number, title, a brief user story, strict scope boundaries (what NOT to do), and why it should be next.]

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

// ─── Main command ───────────────────────────────────────

export interface TriageOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  noCache?: boolean;
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

  const content = runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) console.error(`[${TAG}] Written to ${options.out}`);
  }
}
