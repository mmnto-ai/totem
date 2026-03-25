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
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  RegexValidation,
} from './compiler-schema.js';
import { CompiledRulesFileSchema, CompilerOutputSchema } from './compiler-schema.js';
import { TotemParseError } from './errors.js';

// ─── Re-exports (preserve public API) ──────────────

export type {
  AstContext,
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  DiffAddition,
  RegexValidation,
  RuleEventCallback,
  Violation,
} from './compiler-schema.js';
export {
  CompiledRuleSchema,
  CompiledRulesFileSchema,
  CompilerOutputSchema,
} from './compiler-schema.js';
export { extractAddedLines } from './diff-parser.js';
export {
  applyAstRulesToAdditions,
  applyRules,
  applyRulesToAdditions,
  matchesGlob,
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

/** Load compiled rules from a JSON file. Returns empty array if file missing. */
export function loadCompiledRules(
  rulesPath: string,
  onWarn?: (msg: string) => void,
): CompiledRule[] {
  if (!fs.existsSync(rulesPath)) return [];

  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const json = JSON.parse(raw) as unknown;
    const parsed = CompiledRulesFileSchema.parse(json);
    return parsed.rules;
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

/** Save the full compiled rules file (rules + non-compilable cache). */
export function saveCompiledRulesFile(rulesPath: string, data: CompiledRulesFile): void {
  fs.writeFileSync(rulesPath, JSON.stringify(data, null, 2) + '\n', {
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
export function sanitizeFileGlobs(globs: string[]): string[] {
  const result: string[] = [];
  for (const glob of globs) {
    // Expand brace patterns: **/*.{ts,js} → **/*.ts, **/*.js
    const braceMatch = /^(.*?)\{([^}]+)\}(.*)$/.exec(glob);
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
    result.push(normalizeShallowGlob(glob));
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

/** Build engine-specific fields for a compiled rule. */
export function engineFields(
  engine: 'regex' | 'ast' | 'ast-grep',
  pattern: string | Record<string, unknown>,
): { pattern: string; astGrepPattern?: string | Record<string, unknown>; astQuery?: string } {
  switch (engine) {
    case 'regex':
      return { pattern: String(pattern) };
    case 'ast-grep':
      return { pattern: '', astGrepPattern: pattern };
    case 'ast':
      return { pattern: '', astQuery: String(pattern) };
  }
}

// ─── LLM response parsing ──────────────────────────

/**
 * Parse the LLM's compilation response. Extracts JSON from the response text,
 * validates it, and returns the structured output or null if unparseable.
 */
export function parseCompilerResponse(response: string): CompilerOutput | null {
  // Try to extract JSON from the response (LLMs often wrap in ```json blocks)
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = (jsonMatch?.[1] ?? response).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const result = CompilerOutputSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}
