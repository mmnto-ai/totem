import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import safeRegex from 'safe-regex2';
import { z } from 'zod';

import { extensionToLanguage } from './ast-classifier.js';
import { matchAstQuery } from './ast-query.js';
import { TotemParseError } from './errors.js';

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
  /** Engine type — 'regex' for line-level matching, 'ast' for Tree-sitter S-expression queries */
  engine: z.enum(['regex', 'ast']),
  /** Tree-sitter S-expression query (required when engine is 'ast') */
  astQuery: z.string().optional(),
  /** ISO timestamp of when this rule was compiled */
  compiledAt: z.string(),
  /** ISO timestamp of when this rule was first created (survives recompilation) */
  createdAt: z.string().optional(),
  /** Optional file glob patterns — rule only applies to matching files (e.g., ["*.sh", "*.yml"]) */
  fileGlobs: z.array(z.string()).optional(),
  /** Rule category for Trap Ledger classification */
  category: z.enum(['security', 'architecture', 'style', 'performance']).optional(),
  /** Severity level — error blocks CI, warning reports but doesn't fail */
  severity: z.enum(['error', 'warning']).optional(),
});

export type CompiledRule = z.infer<typeof CompiledRuleSchema>;

export const CompiledRulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(CompiledRuleSchema),
  /** Lesson hashes that the LLM determined cannot be compiled (conceptual/architectural). */
  nonCompilable: z.array(z.string()).optional(),
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

/** Syntactic context of a diff line, determined by AST analysis. */
export type AstContext = 'code' | 'string' | 'comment' | 'regex';

export interface DiffAddition {
  file: string;
  line: string;
  lineNumber: number;
  /** Content of the preceding line in the new file (context or added), null if first in hunk */
  precedingLine: string | null;
  /** Syntactic context from AST analysis — undefined means not classified (fail-open as code) */
  astContext?: AstContext;
}

/**
 * Extract added lines from a unified diff.
 * Returns only lines that start with `+` (excluding `+++` file headers).
 * Tracks the preceding line content (context or added) for suppression support.
 */
export function extractAddedLines(diff: string): DiffAddition[] {
  const additions: DiffAddition[] = [];
  let currentFile = '';
  let lineNum = 0;
  let prevLineContent: string | null = null;
  let insideHunk = false;

  for (const rawLine of diff.split('\n')) {
    // New file block — reset hunk state
    if (rawLine.startsWith('diff ')) {
      insideHunk = false;
      continue;
    }

    // Track current file from diff headers — only BEFORE the first hunk.
    // Inside a hunk, a line starting with +++ is an added line whose
    // content happens to start with ++ (e.g., template literal test fixtures
    // containing embedded diff headers like "+++ b/some-file.ts").
    if (!insideHunk && rawLine.startsWith('+++')) {
      let pathPart = rawLine.slice(4); // strip "+++ "
      // Strip surrounding quotes (git adds them for paths with spaces)
      if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
        pathPart = pathPart.slice(1, -1);
      }
      // Strip the "b/" prefix git uses for the destination file
      currentFile = pathPart.startsWith('b/') ? pathPart.slice(2) : pathPart;
      prevLineContent = null;
      continue;
    }

    // Parse hunk header for line numbers: @@ -X,Y +Z,W @@
    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      insideHunk = true;
      lineNum = parseInt(hunkMatch[1]!, 10) - 1; // will be incremented on first line
      prevLineContent = null;
      continue;
    }

    // Skip diff metadata lines
    if (rawLine.startsWith('---') || rawLine.startsWith('index ')) {
      continue;
    }

    // Count lines for position tracking
    if (rawLine.startsWith('+')) {
      lineNum++;
      const lineContent = rawLine.slice(1); // strip the leading +
      additions.push({
        file: currentFile,
        line: lineContent,
        lineNumber: lineNum,
        precedingLine: prevLineContent,
      });
      prevLineContent = lineContent;
    } else if (rawLine.startsWith('-')) {
      // Deleted line — NOT in new file, don't update prevLineContent or lineNum
    } else if (rawLine.startsWith(' ')) {
      // Context line — in new file
      lineNum++;
      prevLineContent = rawLine.slice(1);
    }
    // Ignore other lines (e.g., '\ No newline at end of file')
  }

  return additions;
}

// ─── Rule execution ──────────────────────────────────

// ─── File glob matching ─────────────────────────────

/**
 * Check if a file path matches a single glob pattern.
 * Supports: `*.ext`, `**\/*.ext`, `dir/**\/*.ext`, `dir/**`, literal filenames.
 */
export function matchesGlob(filePath: string, glob: string): boolean {
  // Normalize separators
  const normalized = filePath.replace(/\\/g, '/');
  // *.ext — match file extension anywhere
  if (glob.startsWith('*.')) {
    return normalized.endsWith(glob.slice(1));
  }
  // **/*.ext — same as *.ext (match extension anywhere in path)
  if (glob.startsWith('**/')) {
    return matchesGlob(normalized, glob.slice(3));
  }
  // dir/**/*.ext or dir/** — directory-prefixed recursive glob
  const dstarIdx = glob.indexOf('/**/');
  if (dstarIdx > 0) {
    const prefix = glob.slice(0, dstarIdx);
    const suffix = glob.slice(dstarIdx + 4); // after "/**/"
    if (!normalized.startsWith(prefix + '/')) return false;
    const rest = normalized.slice(prefix.length + 1);
    return suffix === '' || matchesGlob(rest, suffix);
  }
  // dir/** — match anything under directory (no trailing pattern)
  if (glob.endsWith('/**')) {
    const prefix = glob.slice(0, -3);
    return normalized.startsWith(prefix + '/');
  }
  // dir/*.ext — single-star, non-recursive (matches files in exact directory)
  const singleStarIdx = glob.indexOf('/*.');

  if (singleStarIdx > 0 && !glob.includes('**')) {
    const prefix = glob.slice(0, singleStarIdx);
    const ext = glob.slice(singleStarIdx + 2); // "*.ext" portion
    if (!normalized.startsWith(prefix + '/')) return false;
    const rest = normalized.slice(prefix.length + 1);
    // Must be a direct child (no further slashes) and match the extension
    return !rest.includes('/') && rest.endsWith(ext);
  }

  // Literal filename match (e.g., "Dockerfile")
  return normalized === glob || normalized.endsWith('/' + glob);
}

function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  const positive = globs.filter((g) => !g.startsWith('!'));
  const negative = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));

  const positiveMatch = positive.length === 0 || positive.some((g) => matchesGlob(filePath, g));
  const negativeMatch = negative.some((g) => matchesGlob(filePath, g));

  return positiveMatch && !negativeMatch;
}

// ─── Rule execution ──────────────────────────────────

// ─── Inline suppression ─────────────────────────────

const SUPPRESS_MARKER = 'totem-ignore';
const SUPPRESS_NEXT_LINE_MARKER = 'totem-ignore-next-line';

/**
 * Check if a line should be suppressed via inline directives.
 * Supports two forms:
 * - Same-line: code(); // totem-ignore  (suppresses all rules on this line)
 * - Next-line: // totem-ignore-next-line on the preceding line (suppresses all rules on this line)
 *
 * Syntax-agnostic: works with any comment style (//, #, HTML comments, block comments).
 */
function isSuppressed(line: string, precedingLine: string | null): boolean {
  // Same-line: 'totem-ignore' substring also matches 'totem-ignore-next-line',
  // so directive lines themselves are inherently suppressed.
  if (line.includes(SUPPRESS_MARKER)) return true;

  // Next-line: preceding line (context or added) contains the next-line directive
  if (precedingLine != null && precedingLine.includes(SUPPRESS_NEXT_LINE_MARKER)) return true;

  return false;
}

/** Callback for observability — invoked when a rule is suppressed or triggered. */
export type RuleEventCallback = (event: 'trigger' | 'suppress', lessonHash: string) => void;

/**
 * Apply compiled rules against pre-extracted diff additions.
 * Skips additions with non-code AST context (strings, comments, regex).
 * Optional `onRuleEvent` callback enables observability metrics collection.
 */
export function applyRulesToAdditions(
  rules: CompiledRule[],
  additions: DiffAddition[],
  onRuleEvent?: RuleEventCallback,
): Violation[] {
  if (additions.length === 0 || rules.length === 0) return [];

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
      // Skip non-code lines when AST context is available
      if (addition.astContext && addition.astContext !== 'code') continue;

      // Skip if rule has fileGlobs and this file doesn't match
      if (rule.fileGlobs && rule.fileGlobs.length > 0) {
        if (!fileMatchesGlobs(addition.file, rule.fileGlobs)) continue;
      }

      // Skip if suppressed via inline directive
      if (isSuppressed(addition.line, addition.precedingLine)) {
        if (re.test(addition.line)) {
          onRuleEvent?.('suppress', rule.lessonHash);
        }
        continue;
      }

      if (re.test(addition.line)) {
        onRuleEvent?.('trigger', rule.lessonHash);
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

/**
 * Apply AST-engine compiled rules against pre-extracted diff additions.
 * Async because it reads files and runs Tree-sitter queries.
 * Handles fileGlobs filtering and suppression same as regex rules.
 */
export async function applyAstRulesToAdditions(
  rules: CompiledRule[],
  additions: DiffAddition[],
  cwd: string,
  onRuleEvent?: RuleEventCallback,
): Promise<Violation[]> {
  const astRules = rules.filter((r) => r.engine === 'ast' && r.astQuery);
  if (astRules.length === 0 || additions.length === 0) return [];

  // Group additions by file
  const byFile = new Map<string, DiffAddition[]>();
  for (const a of additions) {
    const existing = byFile.get(a.file);
    if (existing) {
      existing.push(a);
    } else {
      byFile.set(a.file, [a]);
    }
  }

  const violations: Violation[] = [];

  for (const rule of astRules) {
    for (const [file, fileAdditions] of byFile) {
      // Skip if rule has fileGlobs and this file doesn't match
      if (rule.fileGlobs && rule.fileGlobs.length > 0) {
        if (!fileMatchesGlobs(file, rule.fileGlobs)) continue;
      }

      // Check language support
      const path = await import('node:path');
      const ext = path.extname(file);
      if (!extensionToLanguage(ext)) continue;

      // Collect added line numbers, filtering suppressed lines
      const addedLineNumbers: number[] = [];
      const additionsByLine = new Map<number, DiffAddition>();
      for (const addition of fileAdditions) {
        // Skip non-code lines when AST context is available
        if (addition.astContext && addition.astContext !== 'code') continue;

        if (isSuppressed(addition.line, addition.precedingLine)) {
          onRuleEvent?.('suppress', rule.lessonHash);
          continue;
        }

        addedLineNumbers.push(addition.lineNumber);
        additionsByLine.set(addition.lineNumber, addition);
      }

      if (addedLineNumbers.length === 0) continue;

      const matches = await matchAstQuery(file, rule.astQuery!, addedLineNumbers, cwd);

      for (const match of matches) {
        onRuleEvent?.('trigger', rule.lessonHash);
        violations.push({
          rule,
          file,
          line: match.lineText,
          lineNumber: match.lineNumber,
        });
      }
    }
  }

  return violations;
}

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

  return applyRulesToAdditions(rules, additions);
}

// ─── File I/O ────────────────────────────────────────

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

// ─── LLM response parsing ───────────────────────────

/** Schema for the structured JSON the LLM returns when compiling a lesson. */
export const CompilerOutputSchema = z.object({
  compilable: z.boolean(),
  pattern: z.string().optional(),
  message: z.string().optional(),
  fileGlobs: z.array(z.string()).optional(),
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
