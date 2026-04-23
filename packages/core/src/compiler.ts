/**
 * Compiler facade — re-exports from focused modules.
 *
 * Schemas and types:  ./compiler-schema.ts
 * Diff parsing:       ./diff-parser.ts
 * Rule execution:     ./rule-engine.ts
 *
 * This file retains: hashing, regex validation, file I/O, and LLM response parsing.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import safeRegex from 'safe-regex2';
import { z } from 'zod';

import type {
  AstGrepYamlRule,
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  NonCompilableEntry,
  RegexValidation,
} from './compiler-schema.js';
import {
  CompiledRulesFileSchema,
  CompilerOutputSchema,
  NonCompilableEntryWriteSchema,
} from './compiler-schema.js';
import { TotemParseError } from './errors.js';

// ─── Re-exports (preserve public API) ──────────────

export type {
  AstContext,
  AstGrepYamlRule,
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  DiffAddition,
  NapiConfig,
  NonCompilableEntry,
  NonCompilableReasonCode,
  RegexValidation,
  RuleEventCallback,
  RuleEventContext,
  Violation,
} from './compiler-schema.js';
export {
  AstGrepYamlRuleSchema,
  CompiledRuleSchema,
  CompiledRulesFileSchema,
  CompilerOutputSchema,
  LEDGER_RETRY_PENDING_CODES,
  NapiConfigSchema,
  NonCompilableEntryReadSchema,
  NonCompilableEntryWriteSchema,
  NonCompilableReasonCodeSchema,
  shouldWriteToLedger,
} from './compiler-schema.js';
export { extractAddedLines } from './diff-parser.js';
export {
  applyAstRulesToAdditions,
  applyRules,
  applyRulesToAdditions,
  type CoreLogger,
  extractJustification,
  matchesGlob,
  type RuleEngineContext,
} from './rule-engine.js';

// ─── Hashing ────────────────────────────────────────

const HASH_SLICE_LEN = 16;

/** Hash a lesson's heading + body to detect changes since compilation. */
export function hashLesson(heading: string, body: string): string {
  return crypto
    .createHash('sha256')
    .update(`${heading}\n${body}`)
    .digest('hex')
    .slice(0, HASH_SLICE_LEN);
}

// ─── Regex validation ───────────────────────────────

/**
 * Validate that a pattern string is a syntactically valid RegExp
 * and is not vulnerable to ReDoS (catastrophic backtracking).
 */
export function validateRegex(pattern: string): RegexValidation {
  try {
    new RegExp(pattern);
  } catch {
    return { valid: false, reason: 'invalid syntax' };
  }

  if (!safeRegex(pattern)) {
    return { valid: false, reason: 'ReDoS vulnerability detected' };
  }

  return { valid: true };
}

// ─── File I/O ───────────────────────────────────────

/**
 * Load compiled rules from a JSON file. Returns empty array if file missing.
 *
 * Filters out rules with `status === 'archived'` so the lint execution path,
 * rule tester, and every other consumer that enforces rules treats archived
 * entries as silenced (#1336 — "The Archive Lie"). Rules without a `status`
 * field (legacy manifests compiled before the lifecycle state was added) are
 * treated as active — hence `!== 'archived'` rather than `=== 'active'`.
 *
 * Admin and write-path consumers that need to see archived rules (e.g.
 * `totem doctor --pr` lifecycle management, `totem compile` pruning) should
 * use {@link loadCompiledRulesFile} instead, which returns the unfiltered
 * manifest so archived entries remain visible for telemetry and state
 * transitions.
 */
export function loadCompiledRules(
  rulesPath: string,
  onWarn?: (msg: string) => void,
): CompiledRule[] {
  if (!fs.existsSync(rulesPath)) return [];

  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const json = JSON.parse(raw) as unknown;
    const parsed = CompiledRulesFileSchema.parse(json);
    return parsed.rules.filter((r) => r.status !== 'archived');
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (err instanceof z.ZodError) {
      throw new TotemParseError(
        `Invalid compiled-rules.json: ${err.issues.map((i) => i.message).join('; ')}`,
        "Delete the file and run 'totem compile' to regenerate it.",
      );
    }
    onWarn?.(`Could not load compiled rules: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Load the full compiled rules file (rules + non-compilable cache). */
export function loadCompiledRulesFile(
  rulesPath: string,
  onWarn?: (msg: string) => void,
): CompiledRulesFile {
  if (!fs.existsSync(rulesPath)) return { version: 1, rules: [], nonCompilable: [] };

  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const json = JSON.parse(raw) as unknown;
    return CompiledRulesFileSchema.parse(json);
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, rules: [], nonCompilable: [] };
    }
    if (err instanceof z.ZodError) {
      throw new TotemParseError(
        `Invalid compiled-rules.json: ${err.issues.map((i) => i.message).join('; ')}`,
        "Delete the file and run 'totem compile' to regenerate it.",
      );
    }
    onWarn?.(`Could not load compiled rules: ${err instanceof Error ? err.message : String(err)}`);
    return { version: 1, rules: [], nonCompilable: [] };
  }
}

/** Save compiled rules to a JSON file. */
export function saveCompiledRules(rulesPath: string, rules: CompiledRule[]): void {
  const data: CompiledRulesFile = { version: 1, rules };
  fs.writeFileSync(rulesPath, JSON.stringify(data, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o644,
  });
}

/**
 * Save the full compiled rules file (rules + non-compilable cache).
 *
 * Every `nonCompilable` entry is validated through the strict Write schema
 * before serialization per the Read/Write schema invariant (lesson
 * 400fed87). If a caller ever passes Read-schema-shaped data back through
 * save, we surface the bug as a `TotemParseError` rather than letting the
 * permissive union silently re-accept legacy shapes on disk.
 */
export function saveCompiledRulesFile(rulesPath: string, data: CompiledRulesFile): void {
  const validatedNonCompilable: NonCompilableEntry[] | undefined = data.nonCompilable?.map(
    (entry, idx) => {
      const parsed = NonCompilableEntryWriteSchema.safeParse(entry);
      if (!parsed.success) {
        throw new TotemParseError(
          `nonCompilable[${idx}] failed strict write validation: ${parsed.error.issues
            .map((i) => i.message)
            .join('; ')}`,
          'Route ledger writes through NonCompilableEntryWriteSchema so legacy shapes do not leak back to disk.',
          parsed.error,
        );
      }
      return parsed.data;
    },
  );
  const payload: CompiledRulesFile = validatedNonCompilable
    ? { ...data, nonCompilable: validatedNonCompilable }
    : data;
  fs.writeFileSync(rulesPath, JSON.stringify(payload, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o644,
  });
}

// ─── Glob sanitization ─────────────────────────────

/**
 * Expand brace patterns, normalize shallow globs, and strip unsupported syntax.
 * e.g., "**\/*.{ts,js}" → ["**\/*.ts", "**\/*.js"]
 * e.g., "*.ts" → "**\/*.ts" (shallow → recursive)
 */
export function sanitizeFileGlobs(globs: unknown[]): string[] {
  const result: string[] = [];
  for (const glob of globs) {
    if (typeof glob !== 'string') continue;
    const trimmed = glob.trim();
    if (!trimmed || trimmed === '!') continue;

    // Expand brace patterns: **/*.{ts,js} → **/*.ts, **/*.js
    const braceMatch = /^(.*?)\{([^}]+)\}(.*)$/.exec(trimmed);
    if (braceMatch) {
      const prefix = braceMatch[1]!;
      const alternatives = braceMatch[2]!.split(',').map((s) => s.trim());
      const suffix = braceMatch[3]!;
      // Recursively expand remaining brace groups in each result
      for (const alt of alternatives) {
        result.push(...sanitizeFileGlobs([prefix + alt + suffix]));
      }
      continue;
    }
    result.push(normalizeShallowGlob(trimmed));
  }
  return result;
}

/**
 * Normalize shallow glob patterns to recursive form for external tool compatibility.
 * - `*.ts` → `**\/*.ts` (no `/` and doesn't start with `**\/`)
 * - `*` → `**\/*` (bare wildcard)
 * - `src/*.ts` → left alone (contains `/`, intentionally scoped)
 * - `**\/*.ts` → left alone (already recursive)
 * - `!*.ts` → `!**\/*.ts` (negated shallow glob)
 */
function normalizeShallowGlob(glob: string): string {
  // Handle negation: strip prefix, normalize, re-add
  const negated = glob.startsWith('!');
  const bare = negated ? glob.slice(1) : glob;

  // Already recursive or contains a directory separator → leave alone
  if (bare.startsWith('**/') || bare.includes('/')) {
    return glob;
  }

  // Shallow pattern — prepend **/
  return `${negated ? '!' : ''}**/${bare}`;
}

/**
 * Build engine-specific fields for a compiled rule.
 *
 * Overloaded so only the `'ast-grep'` branch accepts a compound
 * `Record<string, unknown>`; `'regex'` and `'ast'` are string-only.
 * This prevents callers from passing a compound object to the regex
 * engine and silently producing `"[object Object]"` via `String(pattern)`.
 */
export function engineFields(
  engine: 'regex' | 'ast',
  pattern: string,
): { pattern: string; astQuery?: string };
export function engineFields(
  engine: 'ast-grep',
  pattern: string | Record<string, unknown>,
): { pattern: string; astGrepPattern?: string; astGrepYamlRule?: AstGrepYamlRule };
// Wildcard overload for callers whose `engine` discriminator is the
// union `'regex' | 'ast' | 'ast-grep'` and is resolved at runtime
// (e.g., compile-lesson.ts:buildManualRule). TypeScript cannot narrow
// the overload without the literal, so we expose the implementation
// signature explicitly. The superRefine on `CompiledRuleSchema` is
// the load-bearing gate; this wildcard merely keeps the type system
// honest at call sites that legitimately forward the union.
export function engineFields(
  engine: 'regex' | 'ast' | 'ast-grep',
  pattern: string | Record<string, unknown>,
): {
  pattern: string;
  astGrepPattern?: string;
  astGrepYamlRule?: AstGrepYamlRule;
  astQuery?: string;
};
export function engineFields(
  engine: 'regex' | 'ast' | 'ast-grep',
  pattern: string | Record<string, unknown>,
): {
  pattern: string;
  astGrepPattern?: string;
  astGrepYamlRule?: AstGrepYamlRule;
  astQuery?: string;
} {
  switch (engine) {
    case 'regex':
      return { pattern: String(pattern) };
    case 'ast-grep':
      // Route strings to the flat field and objects to the compound field.
      // mmnto/totem#1407 split the fields for explicit mutual exclusion; the
      // caller is responsible for passing exactly one shape. The superRefine
      // on CompiledRuleSchema gates the persisted rule.
      if (typeof pattern === 'string') {
        return { pattern: '', astGrepPattern: pattern };
      }
      return { pattern: '', astGrepYamlRule: pattern as AstGrepYamlRule };
    case 'ast':
      return { pattern: '', astQuery: String(pattern) };
  }
}

// ─── LLM response parsing ──────────────────────────

/** Strip leading/trailing backtick wrappers (e.g., `` `pattern` ``, `` ```regex\npattern\n``` ``). */
function stripBacktickWrap(value: string): string {
  const s = value.trim();
  // Multi-line code fence: ```lang\n...\n``` or ~~~lang\n...\n~~~
  const fenceMatch = s.match(/^(```|~~~)[^\n]*\n([\s\S]*?)\n?\1$/);
  if (fenceMatch) return fenceMatch[2]!.trim();
  // Single backtick wrap: `pattern` — only strip if content doesn't contain backticks
  if (s.startsWith('`') && s.endsWith('`') && s.length > 2) {
    const inner = s.slice(1, -1);
    if (!inner.includes('`')) return inner.trim();
  }
  return s;
}

export function parseCompilerResponse(response: string): CompilerOutput | null {
  // Try to extract JSON from the response (LLMs often wrap in ```json blocks)
  const jsonMatch = response.match(/(```|~~~)(?:json)?\s*\n?([\s\S]*?)\n?\1/);
  const jsonStr = (jsonMatch?.[2] ?? response).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const result = CompilerOutputSchema.safeParse(parsed);
    if (!result.success) return null;

    const data = result.data;
    // Strip backtick formatting hallucinations from pattern fields
    if (typeof data.pattern === 'string' && data.pattern) {
      data.pattern = stripBacktickWrap(data.pattern);
    }
    if (typeof data.astGrepPattern === 'string' && data.astGrepPattern) {
      data.astGrepPattern = stripBacktickWrap(data.astGrepPattern);
    }
    if (typeof data.astQuery === 'string' && data.astQuery) {
      data.astQuery = stripBacktickWrap(data.astQuery);
    }
    if (data.fileGlobs) {
      data.fileGlobs = data.fileGlobs.map(stripBacktickWrap);
    }
    return data;
  } catch {
    return null;
  }
}
