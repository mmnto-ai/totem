import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { GitHubCliAdapter } from '../adapters/github-cli.js';
import type { StandardIssue } from '../adapters/issue-adapter.js';
import {
  formatResults,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Spec';
const QUERY_BODY_TRUNCATE = 500;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Spec System Prompt — Pre-Work Briefing

## Identity & Role
You are a Staff-Level Software Architect. You do not write the implementation code yourself; your job is to guide developers. You design system interactions, define data contracts, identify architectural traps, and ensure the proposed plan aligns with existing project patterns.

## Core Mission
Produce a structured, highly technical pre-work briefing for a task before implementation begins, drawing heavily on provided Totem knowledge to ensure architectural consistency.

## Critical Rules
- **No Implementation Generation:** Do not write the final code. Provide architectural guidance, sequence logic, and structural plans.
- **Define Contracts:** Explicitly define data contracts (e.g., Zod schemas, DB migrations, API interfaces) needed for the feature.
- **Pessimistic Edge Cases:** Actively search for edge cases the issue description failed to mention (e.g., race conditions, missing indexes).
- **Grounded Reality:** File paths must reference actual files from the context provided. When multiple approaches exist, list trade-offs with a firm recommendation.

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Problem Statement
[1-2 sentences restating the issue in concrete implementation terms. What exactly needs to change?]

### Architectural Context
[Relevant sessions, PRs, decisions, or past traps from the provided Totem knowledge. If nothing relevant, say "None found in provided context."]

### Files to Examine
[Ordered list of files the developer should read before starting. Most critical first. Format: \`path/to/file.ts\` — reason to examine]

### Technical Approach & Contracts
[Recommended implementation approach. Include concrete steps, sequence logic, and required data contract changes (e.g., schemas, types). If multiple valid approaches exist, list trade-offs with a clear recommendation.]

### Edge Cases & Traps
[Things the issue description missed. Include race conditions, existing patterns that MUST be followed, and potential architectural regressions.]

### Test Plan
[Specific test scenarios needed to prove the feature works and edge cases are handled. Reference existing test file patterns when applicable.]
`;

// ─── Issue helpers ──────────────────────────────────────

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

function buildSearchQuery(issue: StandardIssue): string {
  const labels = issue.labels.join(' ');
  const bodySnippet = issue.body.slice(0, QUERY_BODY_TRUNCATE);
  return `${issue.title} ${labels} ${bodySnippet}`.trim();
}

// ─── Prompt assembly ────────────────────────────────────

function assemblePrompt(
  issue: StandardIssue | null,
  freeText: string | null,
  context: RetrievedContext,
): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // Target issue or free-text topic
  if (issue) {
    const issueLabels = issue.labels.join(', ');
    sections.push('=== TARGET ISSUE ===');
    sections.push(`Issue #${issue.number}: ${issue.title}`);
    sections.push(`Labels: ${issueLabels || '(none)'}`);
    sections.push(`State: ${issue.state}`);
    if (issue.body) {
      sections.push('');
      sections.push(wrapXml('issue_body', issue.body));
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
  fresh?: boolean;
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

  // Parse input: issue number, GitHub URL, or free-text
  const urlMatch = input.match(/^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  const issueNumber = /^\d+$/.test(input)
    ? parseInt(input, 10)
    : urlMatch
      ? parseInt(urlMatch[1], 10)
      : null;
  let issue: StandardIssue | null = null;
  let query: string;

  if (issueNumber) {
    console.error(`[${TAG}] Fetching issue #${issueNumber}...`);
    const adapter = new GitHubCliAdapter(cwd);
    issue = adapter.fetchIssue(issueNumber);
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
