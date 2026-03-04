import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import { z } from 'zod';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore } from '@mmnto/totem';

import { getGitBranch, getGitStatus } from '../git.js';
import {
  formatResults,
  GH_TIMEOUT_MS,
  IS_WIN,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Briefing';
const MAX_SPEC_RESULTS = 5;
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

// ─── GitHub helpers ─────────────────────────────────────

const GhPrListItemSchema = z.object({
  number: z.number(),
  title: z.string(),
  headRefName: z.string(),
});
type GhPrListItem = z.infer<typeof GhPrListItemSchema>;

function fetchOpenPRs(cwd: string): GhPrListItem[] {
  try {
    const result = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName'],
      { cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS, shell: IS_WIN },
    );
    return z.array(GhPrListItemSchema).parse(JSON.parse(result));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`[Totem Error] Failed to parse GitHub PR list response: ${err.message}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        `[Totem Error] GitHub CLI (gh) is required for PR fetching. Install: https://cli.github.com`,
      );
    }
    throw new Error(`[Totem Error] Failed to fetch open PRs: ${msg}`);
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

// ─── Prompt assembly ────────────────────────────────────

function formatPRList(prs: GhPrListItem[]): string {
  if (prs.length === 0) return '(none)';
  return prs.map((pr) => `- #${pr.number} — ${pr.title} (branch: ${pr.headRefName})`).join('\n');
}

function assemblePrompt(
  branch: string,
  status: string,
  prs: GhPrListItem[],
  context: RetrievedContext,
): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // Git state
  sections.push('=== GIT STATE ===');
  sections.push(`Branch: ${branch}`);
  sections.push(
    `Uncommitted changes:\n${status ? wrapXml('git_status', status) : '(clean working tree)'}`,
  );

  // Open PRs
  sections.push('\n=== OPEN PULL REQUESTS ===');
  sections.push(formatPRList(prs));

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

export interface BriefingOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  noCache?: boolean;
}

export async function briefingCommand(options: BriefingOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Gather git state
  console.error(`[${TAG}] Gathering git state...`);
  const branch = getGitBranch(cwd);
  const status = getGitStatus(cwd);
  console.error(`[${TAG}] Branch: ${branch}`);

  // Fetch open PRs
  console.error(`[${TAG}] Fetching open PRs...`);
  const prs = fetchOpenPRs(cwd);
  console.error(`[${TAG}] Found ${prs.length} open PRs.`);

  // Connect to LanceDB
  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = `${branch} active work session priorities`;
  console.error(`[${TAG}] Querying Totem index...`);
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length;
  console.error(
    `[${TAG}] Found: ${context.specs.length} specs, ${context.sessions.length} sessions`,
  );

  // Assemble prompt
  const prompt = assemblePrompt(branch, status, prs, context);
  console.error(`[${TAG}] Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) console.error(`[${TAG}] Written to ${options.out}`);
  }
}
