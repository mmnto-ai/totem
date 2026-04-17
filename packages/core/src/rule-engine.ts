import * as fs from 'node:fs';
import * as path from 'node:path';

import { extensionToLanguage } from './ast-classifier.js';
import type { AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPatternsBatch } from './ast-grep-query.js';
import { matchAstQueriesBatch } from './ast-query.js';
import type {
  CompiledRule,
  DiffAddition,
  RuleEventCallback,
  Violation,
} from './compiler-schema.js';
import { extractAddedLines } from './diff-parser.js';
import { TotemParseError } from './errors.js';

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
    const suffix = glob.slice(1); // e.g., ".ts" or ".test.*"
    if (suffix.endsWith('.*')) {
      // *.test.* — match files with ".test." in the basename (not directory segments)
      const infix = suffix.slice(0, -1); // ".test."
      const basename = normalized.includes('/') // totem-context: this IS the glob matcher — slash check is intentional
        ? normalized.slice(normalized.lastIndexOf('/') + 1)
        : normalized;
      return basename.includes(infix);
    }
    return normalized.endsWith(suffix);
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

  // totem-ignore-next-line — this IS the glob matcher
  if (singleStarIdx > 0 && !glob.includes('**')) {
    const prefix = glob.slice(0, singleStarIdx);
    const ext = glob.slice(singleStarIdx + 2); // "*.ext" portion
    if (!normalized.startsWith(prefix + '/')) return false;
    const rest = normalized.slice(prefix.length + 1);
    if (rest.includes('/')) return false; // totem-context: this IS the glob matcher — slash check is intentional
    // Handle trailing wildcard (e.g., dir/*.test.*)
    if (ext.endsWith('.*')) {
      const infix = ext.slice(0, -1); // ".test."
      return rest.includes(infix); // totem-ignore — this IS the glob matcher
    }
    return rest.endsWith(ext); // totem-ignore — this IS the glob matcher
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

// ─── Inline suppression ─────────────────────────────

const SUPPRESS_MARKER = 'totem-ignore';
const SUPPRESS_NEXT_LINE_MARKER = 'totem-ignore-next-line';
const CONTEXT_MARKER = 'totem-context:';
const CONTEXT_RE = /totem-context:\s*(.+)/;
const LEGACY_CONTEXT_MARKER = 'shield-context:';
const LEGACY_CONTEXT_RE = /shield-context:\s*(.+)/;

/** Injectable logger for core library diagnostics. */
export interface CoreLogger {
  warn(message: string): void;
}

let shieldContextDeprecationWarned = false;
let coreLogger: CoreLogger = { warn: () => {} }; // no-op default — CLI must wire its own logger

function warnShieldContextDeprecation(): void {
  if (!shieldContextDeprecationWarned) {
    shieldContextDeprecationWarned = true;
    coreLogger.warn(
      '⚠ Deprecation: "// shield-context:" is deprecated. Use "// totem-context:" instead. (See ADR-071)',
    );
  }
}

/** Set the logger for core diagnostics. CLI should call this at startup. */
export function setCoreLogger(logger: CoreLogger): void {
  coreLogger = logger;
}

/** @internal — exposed for testing only */
export function resetShieldContextWarning(): void {
  shieldContextDeprecationWarned = false;
  coreLogger = { warn: () => {} };
}

/**
 * Check if a line should be suppressed via inline directives.
 * Supports three forms:
 * - Same-line: code(); // totem-ignore  (suppresses all rules on this line)
 * - Next-line: // totem-ignore-next-line on the preceding line (suppresses all rules on this line)
 * - Context: // totem-context: <reason> — semantic override that suppresses AND records justification
 *
 * Syntax-agnostic: works with any comment style (//, #, HTML comments, block comments).
 */
/** Check if a line contains a context directive (totem-context or legacy shield-context). */
function hasContextDirective(l: string): boolean {
  if (l.includes(CONTEXT_MARKER)) return true;
  if (l.includes(LEGACY_CONTEXT_MARKER)) {
    warnShieldContextDeprecation();
    return true;
  }
  return false;
}

/** Extract justification from a context directive on a single line, or null if none. */
function matchContextDirective(l: string): string | null {
  const primary = l.match(CONTEXT_RE);
  if (primary) return primary[1]!.trim();
  const legacy = l.match(LEGACY_CONTEXT_RE);
  if (legacy) {
    warnShieldContextDeprecation();
    return legacy[1]!.trim();
  }
  return null;
}

function isSuppressed(line: string, precedingLine: string | null): boolean {
  // Same-line: 'totem-ignore' substring also matches 'totem-ignore-next-line',
  // so directive lines themselves are inherently suppressed.
  if (line.includes(SUPPRESS_MARKER)) return true;

  // Same-line: totem-context: or shield-context: (legacy)
  if (hasContextDirective(line)) return true;

  // Next-line: preceding line contains the next-line directive
  if (precedingLine != null && precedingLine.includes(SUPPRESS_NEXT_LINE_MARKER)) return true;

  // Next-line: preceding line contains a context directive
  if (precedingLine != null && hasContextDirective(precedingLine)) return true;

  return false;
}

/**
 * Extract justification text from totem-context: directives.
 * Checks both the current line and the preceding line.
 * Returns empty string for plain totem-ignore (no justification).
 */
export function extractJustification(line: string, precedingLine: string | null): string {
  // Check current line for context directive
  const sameLine = matchContextDirective(line);
  if (sameLine) return sameLine;

  // Check preceding line for context directive
  if (precedingLine) {
    const prevLine = matchContextDirective(precedingLine);
    if (prevLine) return prevLine;
  }

  // Plain totem-ignore has no justification
  return '';
}

// ─── Regex rule execution ───────────────────────────

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

  // Only process regex-engine rules — AST rules have pattern: '' which would match everything
  const regexRules = rules.filter((r) => r.engine === 'regex' || !r.engine);

  for (const rule of regexRules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern);
    } catch (err) {
      // Fail loud (mmnto/totem#1442): invalid regex in a compiled rule means
      // the compile-time validator was bypassed or the manifest was edited
      // by hand. Silently skipping would mark the diff "compliant" while a
      // load-bearing rule is mute. Throw so the operator sees exactly which
      // rule is broken and can fix or archive it. `TotemParseError` is the
      // correct class here — an uncompilable compiled rule is a parse/
      // compilation failure on the rule's source, not a generic check
      // failure (GCA catch on mmnto/totem#1454).
      throw new TotemParseError(
        `Rule ${rule.lessonHash} has an invalid regex pattern and cannot be evaluated.`,
        `Re-run 'totem lesson compile' to regenerate the rule, or archive it via 'totem doctor --pr' if the source lesson cannot produce a valid pattern. Pattern: ${JSON.stringify(rule.pattern)}`,
        err,
      );
    }

    for (const addition of additions) {
      // Skip if rule has fileGlobs and this file doesn't match
      if (rule.fileGlobs && rule.fileGlobs.length > 0) {
        if (!fileMatchesGlobs(addition.file, rule.fileGlobs)) continue;
      }

      // Skip if suppressed via inline directive
      if (isSuppressed(addition.line, addition.precedingLine)) {
        if (re.test(addition.line)) {
          onRuleEvent?.('suppress', rule.lessonHash, {
            file: addition.file,
            line: addition.lineNumber,
            justification: extractJustification(addition.line, addition.precedingLine),
            immutable: rule.immutable,
          });
        }
        continue;
      }

      if (re.test(addition.line)) {
        // Record context telemetry for ALL matches (code, string, comment, regex)
        onRuleEvent?.('trigger', rule.lessonHash, {
          file: addition.file,
          line: addition.lineNumber,
          astContext: addition.astContext,
        });

        // Only emit violations for code context (non-code matches are telemetry-only)
        if (!addition.astContext || addition.astContext === 'code') {
          violations.push({
            rule,
            file: addition.file,
            line: addition.line,
            lineNumber: addition.lineNumber,
          });
        }
      }
    }
  }

  return violations;
}

// ─── AST rule execution ─────────────────────────────

/**
 * Apply AST-engine compiled rules against pre-extracted diff additions.
 * Handles both Tree-sitter S-expression ('ast') and ast-grep ('ast-grep') engines.
 * Async because it reads files and runs Tree-sitter queries.
 * Handles fileGlobs filtering and suppression same as regex rules.
 */
export async function applyAstRulesToAdditions(
  rules: CompiledRule[],
  additions: DiffAddition[],
  workingDirectory: string,
  onRuleEvent?: RuleEventCallback,
  onWarn?: (msg: string) => void,
  readStrategy?: (filePath: string) => Promise<string | null>,
): Promise<Violation[]> {
  const treeSitterRules = rules.filter((r) => r.engine === 'ast' && r.astQuery);
  // Widen to include compound rules (mmnto/totem#1408). A rule is runnable
  // when EITHER `astGrepPattern` (string) or `astGrepYamlRule` (NapiConfig
  // object) is populated. The mutual-exclusion superRefine on
  // CompiledRuleSchema guarantees these do not coexist, so the per-rule
  // dispatch below can safely use an if/else on presence alone.
  const astGrepRules = rules.filter(
    (r) => r.engine === 'ast-grep' && (r.astGrepPattern || r.astGrepYamlRule),
  );
  if ((treeSitterRules.length === 0 && astGrepRules.length === 0) || additions.length === 0) {
    return [];
  }

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

  // Process each file once — batch all applicable queries per file
  for (const [file, fileAdditions] of byFile) {
    // Check language support
    const ext = path.extname(file);
    if (!extensionToLanguage(ext)) continue;

    // Collect added line numbers (suppression is checked post-match so metrics fire)
    const addedLineNumbers: number[] = [];
    for (const addition of fileAdditions) {
      if (addition.astContext && addition.astContext !== 'code') continue;
      addedLineNumbers.push(addition.lineNumber);
    }
    if (addedLineNumbers.length === 0) continue;

    // ── Tree-sitter S-expression rules ────────────────
    if (treeSitterRules.length > 0) {
      const applicableTreeSitter = treeSitterRules.filter((rule) => {
        if (rule.fileGlobs && rule.fileGlobs.length > 0) {
          return fileMatchesGlobs(file, rule.fileGlobs);
        }
        return true;
      });

      if (applicableTreeSitter.length > 0) {
        // Path containment check — prevent traversal outside the project.
        // Uses path.relative() instead of startsWith() to avoid sibling-directory bypass
        // (e.g., /app-secrets bypassing a /app base).
        const normalizedBase = path.resolve(workingDirectory);
        const fullPath = path.join(normalizedBase, file);
        const relative = path.relative(normalizedBase, fullPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          onWarn?.(`Skipped file outside project: ${file}`);
          continue;
        }

        // Batch: parse file once, run all queries against the cached tree
        const queries = applicableTreeSitter.map((rule) => ({
          astQuery: rule.astQuery!,
          addedLineNumbers,
        }));

        const batchResults = await matchAstQueriesBatch(
          file,
          queries,
          workingDirectory,
          onWarn,
          readStrategy,
        );

        // Map results back to violations
        for (let i = 0; i < applicableTreeSitter.length; i++) {
          const rule = applicableTreeSitter[i]!;
          const matches = batchResults[i] ?? [];

          for (const match of matches) {
            const addition = fileAdditions.find((a) => a.lineNumber === match.lineNumber);
            if (addition && isSuppressed(addition.line, addition.precedingLine)) {
              onRuleEvent?.('suppress', rule.lessonHash, {
                file,
                line: match.lineNumber,
                justification: extractJustification(addition.line, addition.precedingLine),
                immutable: rule.immutable,
              });
              continue;
            }

            onRuleEvent?.('trigger', rule.lessonHash, {
              file,
              line: match.lineNumber,
            });
            violations.push({
              rule,
              file,
              line: match.lineText,
              lineNumber: match.lineNumber,
            });
          }
        }
      }
    }

    // ── ast-grep structural pattern rules ─────────────
    if (astGrepRules.length > 0) {
      const applicableAstGrep = astGrepRules.filter((rule) => {
        if (rule.fileGlobs && rule.fileGlobs.length > 0) {
          return fileMatchesGlobs(file, rule.fileGlobs);
        }
        return true;
      });

      if (applicableAstGrep.length > 0) {
        // Read file content once for all ast-grep rules on this file
        let content: string | null = null;
        try {
          const fullPath = path.resolve(workingDirectory, file);
          // Path containment check — prevent traversal outside the project
          const relative = path.relative(path.resolve(workingDirectory), fullPath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            onWarn?.(`Skipped file outside project: ${file} (resolved to ${fullPath})`);
            continue;
          }
          if (readStrategy) {
            content = await readStrategy(file);
          } else {
            content = await fs.promises.readFile(fullPath, 'utf-8');
          }
        } catch (err: unknown) {
          // Explicitly propagate readStrategy errors. Disk reads fall back to null, but staged reads shouldn't.
          if (readStrategy) {
            throw err;
          }
          // Fall through — content stays null for standard file read failures
        }
        if (content) {
          // Batch: parse file once, run all patterns.
          // Each rule carries either astGrepPattern (string) or astGrepYamlRule
          // (NapiConfig object); the batch helper polymorphically dispatches on
          // type. Per-rule try/catch (mmnto/totem#1408 G-7) ensures one
          // malformed rule does not kill the whole file pass: failures flow
          // through the onRuleFailure sink, get mapped back to a lessonHash
          // via the query index, and surface as 'failure' RuleEvent entries.
          const queries = applicableAstGrep.map((rule) => ({
            rule: (rule.astGrepPattern ?? rule.astGrepYamlRule) as AstGrepRule,
            addedLineNumbers,
          }));
          const batchResults = matchAstGrepPatternsBatch(content, ext, queries, (index, err) => {
            const failedRule = applicableAstGrep[index];
            if (!failedRule) return;
            onRuleEvent?.('failure', failedRule.lessonHash, {
              file,
              line: 0,
              failureReason: err.message,
            });
          });

          for (let i = 0; i < applicableAstGrep.length; i++) {
            const rule = applicableAstGrep[i]!;
            const matches = batchResults[i] ?? [];

            for (const match of matches) {
              const addition = fileAdditions.find((a) => a.lineNumber === match.lineNumber);
              if (addition && isSuppressed(addition.line, addition.precedingLine)) {
                onRuleEvent?.('suppress', rule.lessonHash, {
                  file,
                  line: match.lineNumber,
                  justification: addition
                    ? extractJustification(addition.line, addition.precedingLine)
                    : '',
                  immutable: rule.immutable,
                });
                continue;
              }

              onRuleEvent?.('trigger', rule.lessonHash, {
                file,
                line: match.lineNumber,
              });
              violations.push({
                rule,
                file,
                line: match.lineText,
                lineNumber: match.lineNumber,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

// ─── Convenience wrapper ────────────────────────────

/**
 * Apply **regex-engine** compiled rules against added lines from a diff.
 * This is a convenience wrapper that only handles 'regex' engine rules.
 * For 'ast' and 'ast-grep' rules, call `applyAstRulesToAdditions` separately.
 *
 * @param rules — The full list of compiled rules. This function filters to regex rules.
 * @param diff — The unified diff string.
 * @param excludeFiles — File paths to skip (e.g., compiled-rules.json to avoid self-matches).
 * @returns All regex-based violations found.
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
