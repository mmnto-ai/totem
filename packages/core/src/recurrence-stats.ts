/**
 * Recurrence-stats schemas + pure helpers for `totem stats --pattern-recurrence`
 * (mmnto-ai/totem#1715).
 *
 * Substrate of the four-honest-signals "signal 2" instrumentation
 * (same-class-mistake frequency). The data model is consumed by the
 * recurrence-stats command and downstream by the bot-tax circuit
 * breaker (mmnto-ai/totem#1713) and the pre-flight estimator
 * (mmnto-ai/totem#1714).
 *
 * Everything in this file is pure: Zod schemas + deterministic string
 * helpers. No I/O, no command logic — that lives in the cli package.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

// ─── Zod schemas ────────────────────────────────────

/** Source classification of a clustered pattern. */
export const RecurrenceToolSchema = z.enum([
  'coderabbit',
  'gca',
  'sarif',
  'override',
  'mixed',
  'unknown',
]);

export type RecurrenceTool = z.infer<typeof RecurrenceToolSchema>;

/** Normalized severity bucket across CR/GCA/override sources. */
export const RecurrenceSeverityBucketSchema = z.enum(['critical', 'high', 'medium', 'low', 'nit']);

export type RecurrenceSeverityBucket = z.infer<typeof RecurrenceSeverityBucketSchema>;

/** A single cross-PR cluster of bot/override findings sharing one signature. */
export const RecurrencePatternSchema = z.object({
  /** Stable hash of the normalized pattern body — used as cluster key */
  signature: z.string().min(1),
  /** Source classification (`mixed` when one signature spans bots/overrides) */
  tool: RecurrenceToolSchema,
  /** Normalized severity across CR/GCA's different severity vocabularies */
  severityBucket: RecurrenceSeverityBucketSchema,
  /** Total finding count for this signature (>= 1) */
  occurrences: z.number().int().min(1),
  /** PR numbers where this pattern fired (deduped, sorted ascending numerically) */
  prs: z.array(z.string()),
  /** First 3 raw bodies seen — for human triage */
  sampleBodies: z.array(z.string()).max(3),
  /** Earliest finding timestamp (ISO 8601) */
  firstSeen: z.string(),
  /** Latest finding timestamp (ISO 8601) */
  lastSeen: z.string(),
  /** File paths where the pattern fired (deduped, ≤ 10) */
  paths: z.array(z.string()).max(10),
  /** True if signature heuristically maps to an existing compiled rule */
  coveredByRule: z.boolean(),
});

export type RecurrencePattern = z.infer<typeof RecurrencePatternSchema>;

/** Top-level shape persisted at `.totem/recurrence-stats.json`. */
export const RecurrenceStatsSchema = z.object({
  /** Schema version for forward-compat */
  version: z.literal(1),
  /** When this run wrote the file (ISO 8601) */
  lastUpdated: z.string(),
  /** The `--threshold` value used; informs reproducibility */
  thresholdApplied: z.number().int().min(1),
  /** Number of PRs requested via `--history-depth` */
  historyDepth: z.number().int().min(0),
  /** PR numbers actually fetched (post-filter) */
  prsScanned: z.array(z.string()),
  /** Patterns at-or-above threshold; sorted by occurrences descending */
  patterns: z.array(RecurrencePatternSchema),
  /** Patterns that hit existing rules — separate so coverage rate is observable */
  coveredPatterns: z.array(RecurrencePatternSchema),
});

export type RecurrenceStats = z.infer<typeof RecurrenceStatsSchema>;

// ─── Pure helpers — signature normalization ─────────

/**
 * Q5 normalization pipeline for finding bodies before signature hashing.
 *
 * Strips, in order:
 * - Triple-backtick code fences (```…```)
 * - URLs (http(s)://…)
 * - Backtick-spans (`code`)
 * - File paths with optional :line / :line:col suffix
 *   (e.g. `packages/cli/src/foo.ts:42`, `src/x.ts:42:7`)
 * - Standalone line references (`line 42`, `line: 42`, ` :42`)
 * - Leading severity prefixes (`CRITICAL: `, `**Critical**`, etc.)
 *
 * Then lowercases and collapses internal whitespace.
 */
export function normalizeFindingBody(body: string): string {
  let out = body;

  // 1. Strip triple-backtick fenced blocks (with or without language hint).
  out = out.replace(/```[\s\S]*?```/g, ' ');

  // 2. Strip URLs.
  out = out.replace(/https?:\/\/\S+/g, ' ');

  // 3. Strip leading severity prefixes — `**Critical**`, `CRITICAL: `, etc.
  //    Run BEFORE backtick-span stripping so wrapped severity tokens are
  //    captured by the bracket-aware patterns.
  out = out.replace(
    /^\s*(?:\*\*|`)?\s*(?:critical|high|major|medium|minor|low|nit|nitpick|info|warning|error)\s*(?:\*\*|`)?\s*[:.\-—]\s*/i,
    '',
  );
  // Also handle a leading "**Critical**" with no trailing punctuation.
  out = out.replace(
    /^\s*\*\*\s*(?:critical|high|major|medium|minor|low|nit|nitpick|info|warning|error)\s*\*\*\s*/i,
    '',
  );

  // 4. Strip backtick spans, keeping surrounding whitespace.
  out = out.replace(/`[^`]*`/g, ' ');

  // 5. Strip file paths with optional :line / :line:col suffix.
  //    Matches things like `packages/cli/src/foo.ts:42`, `src/x.ts:42:7`,
  //    `./foo.ts`, `../bar/baz.tsx`. A path here is a sequence of
  //    non-space, non-quote tokens containing at least one `/` or `\`
  //    AND ending in a recognized code/text extension.
  out = out.replace(
    /(?:[A-Za-z]:[\\/])?(?:\.{0,2}[\\/])?(?:[\w.\-]+[\\/])+[\w.\-]+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?/g,
    ' ',
  );

  // 6. Strip standalone line references — `line 42`, `line: 42`, ` :42`.
  out = out.replace(/\bline\s*[:\-]?\s*\d+\b/gi, ' ');
  out = out.replace(/(?<=\s):\d+\b/g, ' ');

  // 7. Lowercase + collapse whitespace.
  out = out.toLowerCase().replace(/\s+/g, ' ').trim();

  return out;
}

/**
 * Compute a 16-char hex SHA-256 prefix of the normalized text.
 * Stable + deterministic; collision probability negligible at this
 * input scale (per-repo PR history).
 */
export function computeSignature(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 16);
}

// ─── Pure helpers — Jaccard coverage heuristic ──────

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'of',
  'to',
  'in',
  'and',
  'or',
  'for',
  'on',
  'this',
  'that',
  'it',
  'be',
  'as',
  'at',
  'by',
  'if',
  'not',
  'but',
  'use',
  'using',
]);

/**
 * Tokenize text for Jaccard similarity:
 * - Split on whitespace + non-alphanumerics
 * - Lowercase
 * - Drop tokens of length ≤ 2
 * - Drop a small stopword list
 */
export function tokenizeForJaccard(text: string): Set<string> {
  const lowered = text.toLowerCase();
  const raw = lowered.split(/[^a-z0-9]+/);
  const out = new Set<string>();
  for (const tok of raw) {
    if (tok.length <= 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

/**
 * Jaccard similarity |A ∩ B| / |A ∪ B|. Returns 1.0 on identical sets,
 * 0.0 on disjoint sets, undefined-protected against the empty/empty case
 * (treated as 0 — they're not "the same pattern", they're both empty).
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}
