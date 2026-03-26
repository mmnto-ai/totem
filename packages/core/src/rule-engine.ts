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

let shieldContextDeprecationWarned = false;

function warnShieldContextDeprecation(): void {
  if (!shieldContextDeprecationWarned) {
    shieldContextDeprecationWarned = true;
    console.warn(
      '⚠ Deprecation: "// shield-context:" is deprecated. Use "// totem-context:" instead. (See ADR-071)',
    );
  }
}

/** @internal — exposed for testing only */
export function resetShieldContextWarning(): void {
  shieldContextDeprecationWarned = false;
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
function isSuppressed(line: string, precedingLine: string | null): boolean {
  // Same-line: 'totem-ignore' substring also matches 'totem-ignore-next-line',
  // so directive lines themselves are inherently suppressed.
  if (line.includes(SUPPRESS_MARKER)) return true;

  // Same-line: totem-context: acts as both suppression and override
  if (line.includes('totem-context:')) return true;

  // Same-line: shield-context: legacy alias (ADR-071 Phase 2 — deprecated)
  if (line.includes('shield-context:')) {
    warnShieldContextDeprecation();
    return true;
  }

  // Next-line: preceding line (context or added) contains the next-line directive
  if (precedingLine != null && precedingLine.includes(SUPPRESS_NEXT_LINE_MARKER)) return true;

  // Next-line: preceding line contains totem-context: directive
  if (precedingLine != null && precedingLine.includes('totem-context:')) return true;

  // Next-line: preceding line contains shield-context: legacy alias
  if (precedingLine != null && precedingLine.includes('shield-context:')) {
    warnShieldContextDeprecation();
    return true;
  }

  return false;
}

/**
 * Extract justification text from totem-context: directives.
 * Checks both the current line and the preceding line.
 * Returns empty string for plain totem-ignore (no justification).
 */
export function extractJustification(line: string, precedingLine: string | null): string {
  // Check current line for totem-context: <reason>
  const contextMatch = line.match(/totem-context:\s*(.+)/);
  if (contextMatch) return contextMatch[1]!.trim();

  // Check current line for shield-context: legacy alias
  const legacyMatch = line.match(/shield-context:\s*(.+)/);
  if (legacyMatch) {
    warnShieldContextDeprecation();
    return legacyMatch[1]!.trim();
  }

  // Check preceding line for totem-context:
  if (precedingLine) {
    const prevMatch = precedingLine.match(/totem-context:\s*(.+)/);
    if (prevMatch) return prevMatch[1]!.trim();

    // Preceding line: shield-context: legacy alias
    const prevLegacy = precedingLine.match(/shield-context:\s*(.+)/);
    if (prevLegacy) {
      warnShieldContextDeprecation();
      return prevLegacy[1]!.trim();
    }
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
          onRuleEvent?.('suppress', rule.lessonHash, {
            file: addition.file,
            line: addition.lineNumber,
            justification: extractJustification(addition.line, addition.precedingLine),
          });
        }
        continue;
      }

      if (re.test(addition.line)) {
        onRuleEvent?.('trigger', rule.lessonHash, {
          file: addition.file,
          line: addition.lineNumber,
        });
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
  cwd: string,
  onRuleEvent?: RuleEventCallback,
  onWarn?: (msg: string) => void,
): Promise<Violation[]> {
  const treeSitterRules = rules.filter((r) => r.engine === 'ast' && r.astQuery);
  const astGrepRules = rules.filter((r) => r.engine === 'ast-grep' && r.astGrepPattern);
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
        // Batch: parse file once, run all queries against the cached tree
        const queries = applicableTreeSitter.map((rule) => ({
          astQuery: rule.astQuery!,
          addedLineNumbers,
        }));

        const batchResults = await matchAstQueriesBatch(file, queries, cwd);

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
          const fullPath = path.resolve(cwd, file);
          // Path containment check — prevent traversal outside the project
          const relative = path.relative(path.resolve(cwd), fullPath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            onWarn?.(`Skipped file outside project: ${file} (resolved to ${fullPath})`);
            continue;
          }
          content = await fs.promises.readFile(fullPath, 'utf-8');
        } catch {
          // Fall through — content stays null
        }

        if (content) {
          // Batch: parse file once, run all patterns
          const queries = applicableAstGrep
            .filter((rule) => rule.astGrepPattern != null)
            .map((rule) => ({
              rule: rule.astGrepPattern as AstGrepRule,
              addedLineNumbers,
            }));
          const batchResults = matchAstGrepPatternsBatch(content, ext, queries);

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
