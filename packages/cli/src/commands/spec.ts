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

const TAG = 'Spec';
const QUERY_BODY_TRUNCATE = 500;

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

const GhIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
});
type GhIssue = z.infer<typeof GhIssueSchema>;

function fetchIssue(issueNumber: number, cwd: string): GhIssue {
  try {
    const result = execFileSync(
      'gh',
      ['issue', 'view', String(issueNumber), '--json', 'number,title,body,labels,state'],
      { cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS, shell: IS_WIN },
    );
    return GhIssueSchema.parse(JSON.parse(result));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`[Totem Error] Failed to parse GitHub issue response: ${err.message}`);
    }
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

  const content = runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) console.error(`[${TAG}] Written to ${options.out}`);
  }
}
