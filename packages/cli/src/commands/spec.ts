import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore, TotemConfigError } from '@mmnto/totem';

import type { StandardIssue } from '../adapters/issue-adapter.js';
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

const TAG = 'Spec';
const QUERY_BODY_TRUNCATE = 500;
const MAX_INPUTS = 5;
export const MAX_LESSONS = 10;
export const MAX_LESSON_CHARS = 8_000;
const SPEC_SEARCH_POOL = 20;
const MAX_SPECS = 5;
const MAX_SESSIONS = 5;
const MAX_CODE_RESULTS = 3;

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
- **Lessons Are Law:** If RELEVANT LESSONS are provided, treat each lesson as a hard architectural constraint. Your plan MUST account for every relevant lesson. Call out which lessons influenced your approach in the Architectural Context section.

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

### Implementation Tasks
[Break the work into discrete, ordered tasks. Each task should be completable in 2-10 minutes. For each task:
- Name the files to modify and test
- List concrete steps (write test → verify fails → implement → verify passes → lint)
- If a Totem lesson is relevant to THIS SPECIFIC TASK, inject it inline as:
  > TOTEM INVARIANT: [lesson heading] — [one-line summary of the constraint]
  Place the invariant directly next to the step it affects, not in a separate section.]

### Test Plan
[Specific test scenarios needed to prove the feature works and edge cases are handled. Reference existing test file patterns when applicable.]
`;

// ─── Issue helpers ──────────────────────────────────────

// ─── LanceDB retrieval ─────────────────────────────────

export { SYSTEM_PROMPT as SPEC_SYSTEM_PROMPT };

export interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  code: SearchResult[];
  lessons: SearchResult[];
}

export async function retrieveContext(
  query: string,
  store: LanceStore,
  linkedStores?: LanceStore[],
): Promise<RetrievedContext> {
  const search = (s: LanceStore, typeFilter: ContentType, maxResults: number) =>
    s.search({ query, typeFilter, maxResults });

  // Fetch from primary store
  const [allSpecs, sessions, code] = await Promise.all([
    search(store, 'spec', SPEC_SEARCH_POOL),
    search(store, 'session_log', MAX_SESSIONS),
    search(store, 'code', MAX_CODE_RESULTS),
  ]);

  // Fetch specs from linked stores (cross-totem knowledge)
  if (linkedStores && linkedStores.length > 0) {
    const linkedResults = await Promise.all(
      linkedStores.map((ls) => search(ls, 'spec', MAX_SPECS).catch(() => [] as SearchResult[])), // totem-ignore (#666) — linked store failures are intentionally silent (graceful degradation)
    );
    allSpecs.push(...linkedResults.flat());
    // Re-sort by score after merging
    allSpecs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  // Partition: lessons come from lessons.md, everything else is a spec/ADR
  const { lessons, specs } = partitionLessons(allSpecs, MAX_LESSONS, MAX_SPECS);

  return { specs, sessions, code, lessons };
}

function buildSearchQuery(issue: StandardIssue): string {
  const labels = issue.labels.join(' ');
  const bodySnippet = issue.body.slice(0, QUERY_BODY_TRUNCATE);
  return `${issue.title} ${labels} ${bodySnippet}`.trim();
}

// ─── Input types ────────────────────────────────────────

interface ParsedInput {
  issue: StandardIssue | null;
  freeText: string | null;
}

// ─── Prompt assembly ────────────────────────────────────

export function assemblePrompt(
  inputs: ParsedInput[],
  context: RetrievedContext,
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  for (const { issue, freeText } of inputs) {
    if (issue) {
      const issueLabels = issue.labels.join(', ');
      sections.push(`\n=== ISSUE #${issue.number}: ${issue.title} ===`);
      sections.push(wrapXml('issue_title', issue.title));
      sections.push(`Labels: ${issueLabels || '(none)'}`);
      sections.push(`State: ${issue.state}`);
      if (issue.body) {
        sections.push('');
        sections.push(wrapXml('issue_body', issue.body));
      }
    } else if (freeText) {
      sections.push('\n=== TOPIC ===');
      sections.push(wrapXml('topic_text', freeText));
    }
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

  // Lessons — full bodies, capped by total character budget
  const lessonSection = formatLessonSection(context.lessons, MAX_LESSON_CHARS);
  if (lessonSection) sections.push(lessonSection);

  return sections.join('\n');
}

// ─── Main command ───────────────────────────────────────

export interface SpecOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
}

export async function specCommand(inputs: string[], options: SpecOptions): Promise<void> {
  const unique = [...new Set(inputs)];
  if (unique.length > MAX_INPUTS) {
    throw new TotemConfigError(
      `Too many inputs (${unique.length}). Maximum is ${MAX_INPUTS}.`,
      `Pass at most ${MAX_INPUTS} inputs at a time.`,
      'CONFIG_INVALID',
    );
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Connect to linked indexes (cross-totem knowledge)
  const linkedStores: LanceStore[] = [];
  if (config.linkedIndexes && config.linkedIndexes.length > 0) {
    for (const linkedPath of config.linkedIndexes) {
      try {
        const resolvedPath = path.resolve(cwd, linkedPath);
        const linkedConfigPath = resolveConfigPath(resolvedPath);
        const linkedConfig = await loadConfig(linkedConfigPath);
        const linkedEmbedding = linkedConfig.embedding;
        if (!linkedEmbedding) continue; // Linked totem has no embedder — skip
        const linkedEmbedder = createEmbedder(linkedEmbedding);
        const linkedStore = new LanceStore(
          path.join(resolvedPath, linkedConfig.lanceDir),
          linkedEmbedder,
        );
        await linkedStore.connect();
        linkedStores.push(linkedStore);
        log.dim(TAG, `Linked index: ${linkedPath}`);
      } catch (err) {
        log.warn(
          TAG,
          `Could not connect to linked index at ${linkedPath} — skipping. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Parse and fetch all inputs sequentially
  const { createIssueAdapter } = await import('../adapters/create-issue-adapter.js');
  const adapter = await createIssueAdapter(cwd, config);
  const parsed: ParsedInput[] = [];
  const queryParts: string[] = [];

  for (const input of unique) {
    // Match GitHub, GitLab, or any URL ending in /issues/<number> or /-/issues/<number>
    const urlMatch = input.match(/^https?:\/\/[^/]+\/.*\/(?:-\/)?issues\/(\d+)/);
    // Support owner/repo#123 format for multi-repo disambiguation
    const hashIdx = input.indexOf('#');
    const isQualified =
      hashIdx > 0 && input.includes('/') && /^\d+$/.test(input.slice(hashIdx + 1));
    const qualifiedRepo = isQualified ? input.slice(0, hashIdx) : null;
    const qualifiedNum = isQualified ? parseInt(input.slice(hashIdx + 1), 10) : null;

    const issueNumber = /^\d+$/.test(input)
      ? parseInt(input, 10)
      : urlMatch
        ? parseInt(urlMatch[1]!, 10)
        : qualifiedNum;

    if (issueNumber) {
      // If qualified with owner/repo, create a repo-specific adapter
      let fetchAdapter = adapter;
      if (qualifiedRepo) {
        const { GitHubCliAdapter } = await import('../adapters/github-cli.js');
        fetchAdapter = new GitHubCliAdapter(cwd, qualifiedRepo);
      }
      log.info(TAG, `Fetching issue #${issueNumber}...`);
      const issue = fetchAdapter.fetchIssue(issueNumber);
      log.info(TAG, `Title: ${issue.title}`);
      parsed.push({ issue, freeText: null });
      queryParts.push(buildSearchQuery(issue));
    } else {
      log.info(TAG, `Topic: ${input}`);
      parsed.push({ issue: null, freeText: input });
      queryParts.push(input);
    }
  }

  // Retrieve context from LanceDB
  const query = queryParts.join(' ');
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(
    query,
    store,
    linkedStores.length > 0 ? linkedStores : undefined,
  );
  const totalResults =
    context.specs.length + context.sessions.length + context.code.length + context.lessons.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code, ${context.lessons.length} lessons`,
  );

  // Resolve system prompt (allow .totem/prompts/spec.md override)
  const systemPrompt = getSystemPrompt('spec', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(parsed, context, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);
  }
}
