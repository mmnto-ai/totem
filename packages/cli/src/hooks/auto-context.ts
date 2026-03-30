import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SearchResult, TotemConfig } from '@mmnto/totem';
import { createEmbedder, LanceStore, requireEmbedding, TotemConfigSchema } from '@mmnto/totem';

// ─── Types ────────────────────────────────────────────────

export interface AutoContextOptions {
  branchRef?: string;
  maxCharacters?: number;
  limit?: number;
  projectRoot?: string;
}

export interface AutoContextResult {
  query: string;
  resultsIncluded: number;
  totalFound: number;
  content: string;
  searchMethod: 'hybrid' | 'fts' | 'none';
  durationMs: number;
}

// ─── Branch Parsing ───────────────────────────────────────

const TICKET_RE = /(\d+)/;
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'dev']);

export interface ParsedBranch {
  ticket: string | null;
  query: string;
}

export function parseBranch(branchRef: string): ParsedBranch {
  const branch = branchRef.trim();

  if (!branch || DEFAULT_BRANCHES.has(branch)) {
    return { ticket: null, query: 'project overview' };
  }

  const ticketMatch = branch.match(TICKET_RE);
  const ticket = ticketMatch ? ticketMatch[1]! : null;

  // Build a human-readable query from the branch name
  // e.g. "feat/1095-session-start-v2" → "1095 session start v2"
  const query = branch
    .replace(/^[a-z]+\//i, '') // strip prefix (feat/, fix/, chore/)
    .replace(/[-_/]/g, ' ') // delimiters to spaces
    .trim();

  return { ticket, query: query || 'project overview' };
}

// ─── Budget Truncation ────────────────────────────────────

const DEFAULT_MAX_CHARS = 10_000;
const DEFAULT_LIMIT = 5;

function formatResult(result: SearchResult, index: number): string {
  const header = `### ${index + 1}. ${result.label} (${result.type})`;
  const meta = `**File:** ${result.filePath} | **Score:** ${result.score.toFixed(3)}`;
  const body = result.content;
  return `${header}\n${meta}\n\n${body}`;
}

export function truncateResults(
  results: SearchResult[],
  maxCharacters: number,
): { content: string; included: number } {
  if (results.length === 0) return { content: '', included: 0 };

  const blocks: string[] = [];
  let totalChars = 0;
  let included = 0;

  for (let i = 0; i < results.length; i++) {
    const block = formatResult(results[i]!, i);
    if (totalChars + block.length > maxCharacters && included > 0) break;
    blocks.push(block);
    totalChars += block.length;
    included++;
  }

  const omitted = results.length - included;
  let content = blocks.join('\n\n---\n\n');
  if (omitted > 0) {
    content += `\n\n(${omitted} additional result${omitted > 1 ? 's' : ''} omitted for token budget)`;
  }

  return { content, included };
}

// ─── Config Loading (lightweight) ─────────────────────────

function loadEnvFile(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1]!.trim();
      const raw = match[2]!.trim();
      const value = raw.replace(/^(['"])(.*)(\1)$/, '$2');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

async function loadConfig(configPath: string): Promise<TotemConfig> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath)) as Record<string, unknown>;
  const raw = mod['default'] ?? mod;
  return TotemConfigSchema.parse(raw);
}

// ─── Main Pipeline ────────────────────────────────────────

export async function getAutoContext(options?: AutoContextOptions): Promise<AutoContextResult> {
  const start = Date.now();
  const projectRoot = options?.projectRoot ?? process.cwd();
  const maxCharacters = options?.maxCharacters ?? DEFAULT_MAX_CHARS;
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const branchRef = options?.branchRef ?? 'main';

  const { query } = parseBranch(branchRef);
  const empty: AutoContextResult = {
    query,
    resultsIncluded: 0,
    totalFound: 0,
    content: '',
    searchMethod: 'none',
    durationMs: Date.now() - start,
  };

  // ── Locate config & LanceDB ──
  const configPath = path.join(projectRoot, 'totem.config.ts');
  if (!fs.existsSync(configPath)) return { ...empty, durationMs: Date.now() - start };

  let config: TotemConfig;
  try {
    loadEnvFile(projectRoot);
    config = await loadConfig(configPath);
  } catch {
    return { ...empty, durationMs: Date.now() - start };
  }

  const storePath = path.join(projectRoot, config.lanceDir);
  if (!fs.existsSync(storePath)) return { ...empty, durationMs: Date.now() - start };

  // ── Try vector/hybrid search first ──
  let store: LanceStore | null = null;
  let results: SearchResult[] = [];
  let searchMethod: 'hybrid' | 'fts' | 'none' = 'none';

  try {
    const embedding = requireEmbedding(config);
    const embedder = createEmbedder(embedding);
    store = new LanceStore(storePath, embedder, (msg) => {
      process.stderr.write(`[auto-context] ${msg}\n`);
    });
    await store.connect();

    if (await store.isEmpty()) return { ...empty, durationMs: Date.now() - start };

    results = await store.search({ query, maxResults: limit });
    searchMethod = 'hybrid';
  } catch (err) {
    // Embedder failed (no API key, network error, etc.) — try FTS fallback
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[auto-context] Vector search failed, trying FTS fallback: ${msg}\n`);

    try {
      if (!store) {
        // Need a store without a real embedder — create with a dummy
        // LanceStore only needs the embedder for search(), not searchFts()
        const dummyEmbedder = {
          dimensions: 768,
          embed: () => Promise.reject(new Error('no embedder')),
        };
        store = new LanceStore(storePath, dummyEmbedder as never, (msg) => {
          process.stderr.write(`[auto-context] ${msg}\n`);
        });
        await store.connect();
      }

      if (await store.isEmpty()) return { ...empty, durationMs: Date.now() - start };

      results = await store.searchFts({ query, maxResults: limit });
      searchMethod = 'fts';
    } catch (ftsErr) {
      const ftsMsg = ftsErr instanceof Error ? ftsErr.message : String(ftsErr);
      process.stderr.write(`[auto-context] FTS fallback also failed: ${ftsMsg}\n`);
      return { ...empty, durationMs: Date.now() - start };
    }
  }

  const { content, included } = truncateResults(results, maxCharacters);

  return {
    query,
    resultsIncluded: included,
    totalFound: results.length,
    content,
    searchMethod,
    durationMs: Date.now() - start,
  };
}
