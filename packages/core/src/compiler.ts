import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import safeRegex from 'safe-regex2';
import { z } from 'zod';

// ─── Schemas ─────────────────────────────────────────

export const CompiledRuleSchema = z.object({
  /** SHA-256 hash (first 16 hex chars) of heading + body — detects edits */
  lessonHash: z.string(),
  /** Human-readable heading from the lesson (for diagnostics) */
  lessonHeading: z.string(),
  /** Regex pattern to match against added diff lines */
  pattern: z.string(),
  /** Human-readable violation message shown when the pattern matches */
  message: z.string(),
  /** Engine type — only 'regex' for MVP */
  engine: z.literal('regex'),
  /** ISO timestamp of when this rule was compiled */
  compiledAt: z.string(),
});

export type CompiledRule = z.infer<typeof CompiledRuleSchema>;

export const CompiledRulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(CompiledRuleSchema),
});

export type CompiledRulesFile = z.infer<typeof CompiledRulesFileSchema>;

// ─── Violation type ──────────────────────────────────

export interface Violation {
  /** The rule that was violated */
  rule: CompiledRule;
  /** The file path from the diff where the violation occurred */
  file: string;
  /** The matching line content */
  line: string;
  /** 1-based line number within the diff hunk (approximate) */
  lineNumber: number;
}

// ─── Hashing ─────────────────────────────────────────

const HASH_SLICE_LEN = 16;

/** Hash a lesson's heading + body to detect changes since compilation. */
export function hashLesson(heading: string, body: string): string {
  return crypto
    .createHash('sha256')
    .update(`${heading}\n${body}`)
    .digest('hex')
    .slice(0, HASH_SLICE_LEN);
}

// ─── Regex validation ────────────────────────────────

export interface RegexValidation {
  valid: boolean;
  reason?: string;
}

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

// ─── Diff parsing ────────────────────────────────────

interface DiffAddition {
  file: string;
  line: string;
  lineNumber: number;
}

/**
 * Extract added lines from a unified diff.
 * Returns only lines that start with `+` (excluding `+++` file headers).
 */
export function extractAddedLines(diff: string): DiffAddition[] {
  const additions: DiffAddition[] = [];
  let currentFile = '';
  let lineNum = 0;

  for (const rawLine of diff.split('\n')) {
    // Track current file from diff headers
    // git quotes paths containing spaces: +++ "b/path with spaces/file.ts"
    if (rawLine.startsWith('+++')) {
      let pathPart = rawLine.slice(4); // strip "+++ "
      // Strip surrounding quotes (git adds them for paths with spaces)
      if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
        pathPart = pathPart.slice(1, -1);
      }
      // Strip the "b/" prefix git uses for the destination file
      currentFile = pathPart.startsWith('b/') ? pathPart.slice(2) : pathPart;
      continue;
    }

    // Parse hunk header for line numbers: @@ -X,Y +Z,W @@
    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      lineNum = parseInt(hunkMatch[1]!, 10) - 1; // will be incremented on first line
      continue;
    }

    // Skip diff metadata lines
    if (rawLine.startsWith('---') || rawLine.startsWith('diff ') || rawLine.startsWith('index ')) {
      continue;
    }

    // Count lines for position tracking
    if (rawLine.startsWith('+')) {
      lineNum++;
      additions.push({
        file: currentFile,
        line: rawLine.slice(1), // strip the leading +
        lineNumber: lineNum,
      });
    } else if (!rawLine.startsWith('-')) {
      // Context line (no prefix or space prefix) — increment line counter
      lineNum++;
    }
  }

  return additions;
}

// ─── Rule execution ──────────────────────────────────

/**
 * Apply compiled rules against added lines from a diff.
 * Returns all violations found.
 * @param excludeFiles — file paths to skip (e.g., compiled-rules.json to avoid self-matches)
 */
export function applyRules(
  rules: CompiledRule[],
  diff: string,
  excludeFiles?: string[],
): Violation[] {
  let additions = extractAddedLines(diff);
  if (additions.length === 0 || rules.length === 0) return [];

  if (excludeFiles && excludeFiles.length > 0) {
    const excluded = new Set(excludeFiles);
    additions = additions.filter((a) => !excluded.has(a.file));
  }

  const violations: Violation[] = [];

  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern);
    } catch {
      // Skip invalid patterns (shouldn't happen if validation gate works)
      continue;
    }

    for (const addition of additions) {
      if (re.test(addition.line)) {
        violations.push({
          rule,
          file: addition.file,
          line: addition.line,
          lineNumber: addition.lineNumber,
        });
      }
    }
  }

  return violations;
}

// ─── File I/O ────────────────────────────────────────

/** Load compiled rules from a JSON file. Returns empty array if file missing or invalid. */
export function loadCompiledRules(rulesPath: string): CompiledRule[] {
  if (!fs.existsSync(rulesPath)) return [];

  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const parsed = CompiledRulesFileSchema.parse(JSON.parse(raw));
    return parsed.rules;
  } catch {
    return [];
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

// ─── LLM response parsing ───────────────────────────

/** Schema for the structured JSON the LLM returns when compiling a lesson. */
export const CompilerOutputSchema = z.object({
  compilable: z.boolean(),
  pattern: z.string().optional(),
  message: z.string().optional(),
});

export type CompilerOutput = z.infer<typeof CompilerOutputSchema>;

/**
 * Parse the LLM's compilation response. Extracts JSON from the response text,
 * validates it, and returns the structured output or null if unparseable.
 */
export function parseCompilerResponse(response: string): CompilerOutput | null {
  // Try to extract JSON from the response (LLMs often wrap in ```json blocks)
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1]! : response.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const result = CompilerOutputSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}
