import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { GitHubCliPrAdapter } from '../adapters/github-cli-pr.js';
import type { StandardPrListItem } from '../adapters/pr-adapter.js';
import { getGitBranch, getGitStatus } from '../git.js';
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

const TAG = 'Briefing';
const SPEC_SEARCH_POOL = 20;
const MAX_SPEC_RESULTS = 5;
const MAX_LESSONS = 5;
const MAX_SESSION_RESULTS = 5;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Briefing System Prompt — Session Startup Briefing

## Purpose
Produce a session startup briefing that orients the developer at the start of an AI-assisted work session.

## Role
You are a technical project assistant producing a quick-start briefing. You have access to the current git state, open pull requests, and project knowledge from Totem. Your job is to synthesize this into an actionable summary so the developer knows exactly where they left off and what to do next.

## Rules
- Reference PRs by number (#NNN) and branch name
- Reference issues by number (#NNN) when they appear in Totem knowledge
- Be opinionated about what the recommended first action should be
- Be concise — this is a startup briefing, not a project plan
- If there are uncommitted changes, flag them prominently
- If there are no open PRs, say so

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Session Context
[Current branch, uncommitted changes summary. If working tree is clean, say so. If on a feature branch, note what it likely relates to.]

### Open PRs
[List of open PRs with number, title, and branch. If none, say "No open PRs." Highlight any that are the developer's current branch.]

### Active Priorities
[Key priorities and recent work context from Totem knowledge — what was recently worked on, what specs are active, what sessions covered. If no relevant knowledge, say "No recent context found in Totem index."]

### Recommended First Action
[Single clear recommendation for what the developer should do first in this session. Consider: uncommitted work to commit/continue, PRs to review/merge, next issue to pick up.]
`;

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

// ─── Prompt assembly ────────────────────────────────────

export function formatPRList(prs: StandardPrListItem[]): string {
  if (prs.length === 0) return '(none)';
  return prs.map((pr) => `- #${pr.number} — ${pr.title} (branch: ${pr.headRefName})`).join('\n');
}

export function assemblePrompt(
  branch: string,
  status: string,
  prs: StandardPrListItem[],
  context: RetrievedContext,
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  // Git state
  sections.push('=== GIT STATE ===');
  sections.push(`Branch: ${branch}`);
  sections.push(
    `Uncommitted changes:\n${status ? wrapXml('git_status', status) : '(clean working tree)'}`,
  );

  // Open PRs
  sections.push('\n=== OPEN PULL REQUESTS ===');
  sections.push(formatPRList(prs));

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

export interface BriefingOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
}

export async function briefingCommand(options: BriefingOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Gather git state
  log.info(TAG, 'Gathering git state...');
  const branch = getGitBranch(cwd);
  const status = getGitStatus(cwd);
  log.info(TAG, `Branch: ${branch}`);

  // Fetch open PRs
  log.info(TAG, 'Fetching open PRs...');
  const adapter = new GitHubCliPrAdapter(cwd);
  const prs = adapter.fetchOpenPRs();
  log.info(TAG, `Found ${prs.length} open PRs.`);

  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = `${branch} active work session priorities`;
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length + context.lessons.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.lessons.length} lessons`,
  );

  // Resolve system prompt (allow .totem/prompts/briefing.md override)
  const systemPrompt = getSystemPrompt('briefing', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(branch, status, prs, context, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);
  }
}
