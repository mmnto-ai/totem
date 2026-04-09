import type { ContentType, LanceStore, SearchResult } from '@mmnto/totem';

import type { StandardIssue } from '../adapters/issue-adapter.js';
import { SYSTEM_PROMPT } from './spec-templates.js';

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

export { SPEC_SYSTEM_PROMPT } from './spec-templates.js';

// ─── Issue helpers ──────────────────────────────────────

// ─── LanceDB retrieval ─────────────────────────────────

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
  const { log } = await import('../ui.js');
  const { partitionLessons } = await import('../utils.js');
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
      linkedStores.map((ls) =>
        search(ls, 'spec', MAX_SPECS).catch((err) => {
          // Network/connection failures → graceful degradation (return empty)
          // Config/parse errors → surface to user so they can fix their setup
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') ||
            msg.includes('FetchError')
          ) {
            return [] as SearchResult[];
          }
          log.warn(TAG, `Linked store query failed: ${msg}`);
          return [] as SearchResult[];
        }),
      ),
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

const TEST_KEYWORD_RE =
  /\b(test(?:s|ing)?|verif(?:y|ies|ication)|example(?:s)?|fixture(?:s)?|hits|misses|rule-?tester)\b/i;
const TEST_EXPANSION = ' test testing infrastructure fixture verification testRule rule-tester';

/**
 * Expand a spec search query with test-infrastructure keywords when the
 * original query mentions testing concepts.  This helps the vector search
 * surface existing helpers like `rule-tester.ts`.
 */
export function expandSpecQuery(query: string): string {
  return TEST_KEYWORD_RE.test(query) ? query + TEST_EXPANSION : query;
}

// ─── Input types ────────────────────────────────────────

interface ParsedInput {
  issue: StandardIssue | null;
  freeText: string | null;
}

// ─── Prompt assembly ────────────────────────────────────

export async function assemblePrompt(
  inputs: ParsedInput[],
  context: RetrievedContext,
  systemPrompt: string,
): Promise<string> {
  const { formatLessonSection, formatResults, wrapXml } = await import('../utils.js');
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

  // Prior art concierge (#1015): inject shared helper signatures
  const { formatSharedHelpers, getSharedHelpers } = await import('@mmnto/totem');
  const helperSection = formatSharedHelpers(getSharedHelpers());
  if (helperSection) {
    sections.push('\n' + helperSection);
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

export async function specCommand(inputs: string[], options: SpecOptions): Promise<void> {
  const path = await import('node:path');
  const {
    createEmbedder,
    LanceStore: LanceStoreImpl,
    TotemConfigError,
  } = await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const {
    getSystemPrompt,
    loadConfig,
    loadEnv,
    requireEmbedding,
    resolveConfigPath,
    runOrchestrator,
    writeOutput,
  } = await import('../utils.js');

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
  const store = new LanceStoreImpl(path.join(cwd, config.lanceDir), embedder, {
    absolutePathRoot: cwd,
  });
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
        // Derive a link name for sourceContext — basename of the resolved
        // path with leading dot stripped, matching the MCP server's
        // `deriveLinkName` convention (mmnto/totem#1295).
        const linkName = path.basename(resolvedPath).replace(/^\./, '');
        const linkedStore = new LanceStoreImpl(
          path.join(resolvedPath, linkedConfig.lanceDir),
          linkedEmbedder,
          { sourceRepo: linkName, absolutePathRoot: resolvedPath },
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
  const query = expandSpecQuery(queryParts.join(' '));
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
  const prompt = await assemblePrompt(parsed, context, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);
  }
}
