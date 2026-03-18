import type { NapiConfig } from '@ast-grep/napi';
import { Lang, parse } from '@ast-grep/napi';

// ─── Types ──────────────────────────────────────────

/** ast-grep pattern: either a simple string or a full NapiConfig rule object */
export type AstGrepRule = string | NapiConfig;

export interface AstGrepMatch {
  lineNumber: number;
  lineText: string;
}

// ─── Language mapping ───────────────────────────────

/** Map file extensions to ast-grep Lang enum. */
function extensionToLang(ext: string): Lang | undefined {
  switch (ext.toLowerCase()) {
    case '.ts':
      return Lang.TypeScript;
    case '.tsx':
      return Lang.Tsx;
    case '.js':
    case '.mjs':
    case '.cjs':
      return Lang.JavaScript;
    case '.jsx':
      return Lang.Tsx;
    default:
      return undefined;
  }
}

// ─── Core matching ──────────────────────────────────

function executeQuery(
  root: import('@ast-grep/napi').SgRoot,
  rule: AstGrepRule,
  addedLineNumbers: number[],
  lines: string[],
): AstGrepMatch[] {
  if (addedLineNumbers.length === 0) return [];

  const addedSet = new Set(addedLineNumbers);

  try {
    // findAll accepts both string patterns and NapiConfig objects
    const matches =
      typeof rule === 'string' ? root.root().findAll(rule) : root.root().findAll(rule);
    const results: AstGrepMatch[] = [];

    for (const match of matches) {
      const startLine = match.range().start.line + 1;
      const endLine = match.range().end.line + 1;

      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        if (addedSet.has(lineNum)) {
          results.push({
            lineNumber: lineNum,
            lineText: lines[lineNum - 1] ?? '',
          });
          break;
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Public API ─────────────────────────────────────

/**
 * Run an ast-grep pattern against file content, filtering to added lines.
 * Accepts either a string pattern or a NapiConfig rule object (compound rules).
 */
export function matchAstGrepPattern(
  content: string,
  ext: string,
  pattern: AstGrepRule,
  addedLineNumbers: number[],
): AstGrepMatch[] {
  const lang = extensionToLang(ext);
  if (!lang) return [];

  try {
    const root = parse(lang, content);
    return executeQuery(root, pattern, addedLineNumbers, content.split('\n'));
  } catch {
    return [];
  }
}

/**
 * Parse a file once and run multiple ast-grep rules against it.
 * O(M + N) — file parsed exactly once regardless of rule count.
 * Returns results indexed by position in the input array.
 */
export function matchAstGrepPatternsBatch(
  content: string,
  ext: string,
  queries: Array<{ rule: AstGrepRule; addedLineNumbers: number[] }>,
): AstGrepMatch[][] {
  if (queries.length === 0) return [];

  const lang = extensionToLang(ext);
  if (!lang) {
    return queries.map(() => []);
  }

  const lines = content.split('\n');

  try {
    const root = parse(lang, content);
    return queries.map(({ rule, addedLineNumbers }) =>
      executeQuery(root, rule, addedLineNumbers, lines),
    );
  } catch {
    return queries.map(() => []);
  }
}
