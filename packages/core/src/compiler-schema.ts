import { z } from 'zod';

// ─── Compiled rule schemas ──────────────────────────

export const CompiledRuleSchema = z.object({
  /** SHA-256 hash (first 16 hex chars) of heading + body — detects edits */
  lessonHash: z.string(),
  /** Human-readable heading from the lesson (for diagnostics) */
  lessonHeading: z.string(),
  /** Regex pattern to match against added diff lines */
  pattern: z.string(),
  /** Human-readable violation message shown when the pattern matches */
  message: z.string(),
  /** Engine type — 'regex' for line-level matching, 'ast' for Tree-sitter S-expression queries, 'ast-grep' for ast-grep structural patterns */
  engine: z.enum(['regex', 'ast', 'ast-grep']),
  /** Tree-sitter S-expression query (required when engine is 'ast') */
  astQuery: z.string().optional(),
  /** ast-grep pattern — string for simple patterns, object for compound rules (has/inside/not) */
  astGrepPattern: z.union([z.string(), z.record(z.unknown())]).optional(),
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
  /** Lifecycle status — active rules are enforced, archived rules are skipped */
  status: z.enum(['active', 'archived']).optional(),
  /** Reason for archiving (when status is 'archived') */
  archivedReason: z.string().optional(),
});

export type CompiledRule = z.infer<typeof CompiledRuleSchema>;

export const CompiledRulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(CompiledRuleSchema),
  /** Lesson hashes that the LLM determined cannot be compiled (conceptual/architectural). */
  nonCompilable: z.array(z.string()).optional(),
});

export type CompiledRulesFile = z.infer<typeof CompiledRulesFileSchema>;

// ─── Compiler output schema ─────────────────────────

/** Schema for the structured JSON the LLM returns when compiling a lesson. */
export const CompilerOutputSchema = z.object({
  compilable: z.boolean(),
  pattern: z.string().optional(),
  message: z.string().optional(),
  fileGlobs: z.array(z.string()).optional(),
  engine: z.enum(['regex', 'ast', 'ast-grep']).optional(),
  astQuery: z.string().optional(),
  astGrepPattern: z.union([z.string(), z.record(z.unknown())]).optional(),
  severity: z.enum(['error', 'warning']).optional(),
  /** LLM explanation for why a lesson was marked non-compilable */
  reason: z.string().optional(),
});

export type CompilerOutput = z.infer<typeof CompilerOutputSchema>;

// ─── Violation type ─────────────────────────────────

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

// ─── Diff types ─────────────────────────────────────

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

// ─── Shared types ───────────────────────────────────

export interface RegexValidation {
  valid: boolean;
  reason?: string;
}

/** Context passed alongside rule events for Trap Ledger integration. */
export interface RuleEventContext {
  file: string;
  line: number;
  justification?: string;
  /** AST context where the rule fired (code, string, comment, regex). */
  astContext?: AstContext;
}

/** Callback for observability — invoked when a rule is suppressed or triggered. */
export type RuleEventCallback = (
  event: 'trigger' | 'suppress',
  lessonHash: string,
  context?: RuleEventContext,
) => void;
