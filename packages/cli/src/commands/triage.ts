import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import type { StandardIssueListItem } from '../adapters/issue-adapter.js';
import { log } from '../ui.js';
import {
  formatLessonSection,
  formatResults,
  getSystemPrompt,
  loadConfig,
  loadEnv,
  partitionLessons,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Triage';
const SPEC_SEARCH_POOL = 20;
const MAX_SPEC_RESULTS = 5;
const MAX_LESSONS = 5;
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
- **Enforce Lessons:** If RELEVANT LESSONS are provided, treat them as hard constraints on prioritization. Issues that conflict with lessons should be deprioritized or flagged.

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

// ─── Issue helpers ──────────────────────────────────────

// ─── LanceDB retrieval ─────────────────────────────────

interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  lessons: SearchResult[];
}

async function retrieveContext(query: string, store: LanceStore): Promise<RetrievedContext> {
  const search = (typeFilter: ContentType, maxResults: number) =>
    store.search({ query, typeFilter, maxResults });

  const [allSpecs, sessions] = await Promise.all([
    search('spec', SPEC_SEARCH_POOL),
    search('session_log', MAX_SESSION_RESULTS),
  ]);

  const { lessons, specs } = partitionLessons(allSpecs, MAX_LESSONS, MAX_SPEC_RESULTS);

  return { specs, sessions, lessons };
}

function buildSearchQuery(issues: StandardIssueListItem[]): string {
  const titles = issues.map((i) => i.title).join(' ');
  const labels = [...new Set(issues.flatMap((i) => i.labels))].join(' ');
  return `${titles} ${labels}`.slice(0, QUERY_TITLES_TRUNCATE).trim();
}

// ─── Prompt assembly ────────────────────────────────────

export function formatIssueInventory(issues: StandardIssueListItem[]): string {
  const hasMultiRepo = issues.some((i) => i.repo);

  const rows = issues.map((i) => {
    const labels = i.labels.join(', ') || '(none)';
    const updated = i.updatedAt.slice(0, 10); // YYYY-MM-DD
    const prefix = hasMultiRepo && i.repo ? `${i.repo}#${i.number}` : `#${i.number}`;
    return hasMultiRepo
      ? `| ${prefix} | ${i.title} | ${labels} | ${updated} |`
      : `| #${i.number} | ${i.title} | ${labels} | ${updated} |`;
  });

  return [
    hasMultiRepo ? '| Issue | Title | Labels | Updated |' : '| Issue | Title | Labels | Updated |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

export function assemblePrompt(
  issues: StandardIssueListItem[],
  context: RetrievedContext,
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  // Issue inventory
  sections.push('=== OPEN ISSUES ===');
  sections.push(`Total: ${issues.length} open issues\n`);
  sections.push(wrapXml('issue_list', formatIssueInventory(issues)));

  // Totem knowledge (condensed — fast-boot command, minimize token usage)
  const specSection = formatResults(context.specs, 'RECENT SPECS & ADRs', true);
  const sessionSection = formatResults(context.sessions, 'RECENT SESSION HISTORY', true);

  if (specSection || sessionSection) {
    sections.push('\n=== TOTEM KNOWLEDGE ===');
    if (specSection) sections.push(specSection);
    if (sessionSection) sections.push(sessionSection);
  }

  // Lessons — condensed snippets for fast-boot command
  const lessonSection = formatLessonSection(context.lessons, undefined, true);
  if (lessonSection) sections.push(lessonSection);

  return sections.join('\n');
}

// ─── Main command ───────────────────────────────────────

export interface TriageOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
}

export async function triageCommand(options: TriageOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Fetch open issues
  log.info(TAG, 'Fetching open issues...');
  const { createIssueAdapter } = await import('../adapters/create-issue-adapter.js');
  const adapter = await createIssueAdapter(cwd, config);
  const issues = adapter.fetchOpenIssues(GH_ISSUE_LIMIT);

  if (issues.length === 0) {
    log.warn(TAG, 'No open issues found. Nothing to triage.');
    return;
  }

  log.info(TAG, `Found ${issues.length} open issues.`);

  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = buildSearchQuery(issues);
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length + context.lessons.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.lessons.length} lessons`,
  );

  // Resolve system prompt (allow .totem/prompts/triage.md override)
  const systemPrompt = getSystemPrompt('triage', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(issues, context, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);
  }
}
