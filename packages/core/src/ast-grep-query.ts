import type { NapiConfig } from '@ast-grep/napi';
import { Lang, parse } from '@ast-grep/napi';

import { rethrowAsParseError } from './errors.js';

// ─── Types ──────────────────────────────────────────

/** ast-grep pattern: either a simple string or a full NapiConfig rule object */
export type AstGrepRule = string | NapiConfig;

export interface AstGrepMatch {
  lineNumber: number;
  lineText: string;
}

// ─── Constants ──────────────────────────────────────

const AST_GREP_HINT =
  'Check the rule pattern syntax. If valid, the source file may contain syntax that crashes the parser.';

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

/**
 * Per-rule failure sink. Invoked when `findAll` throws inside a batch. The
 * index is the position of the failing query in the original input array so
 * the caller can map the failure back to a `CompiledRule`. Introduced in
 * mmnto/totem#1408 to fulfil spike finding G-7: one malformed compound rule
 * must not blast-radius the whole file's ast-grep pass.
 */
export type OnRuleFailure = (index: number, err: Error) => void;

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
    const matches = root.root().findAll(rule);
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
  } catch (err) {
    rethrowAsParseError('ast-grep query failed', err, AST_GREP_HINT);
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
  } catch (err) {
    rethrowAsParseError('ast-grep parse failed', err, AST_GREP_HINT);
  }
}

/**
 * Parse a file once and run multiple ast-grep rules against it.
 * O(M + N) - file parsed exactly once regardless of rule count.
 * Returns results indexed by position in the input array.
 *
 * When `onRuleFailure` is passed, each per-rule `findAll` call runs inside
 * its own try/catch (spike finding G-7, mmnto/totem#1408): a malformed
 * compound rule emits a failure event, yields an empty result array for
 * that index, and the remaining rules continue to execute. Without the
 * sink, the legacy fail-closed behavior holds - the first per-rule failure
 * aborts the whole batch via `TotemParseError`.
 *
 * The parse-time failure (invalid source, unsupported language) still
 * escapes via `rethrowAsParseError` regardless of the sink, because a parse
 * error affects every query on the file and there is no way to produce
 * honest per-rule results from a broken tree.
 */
export function matchAstGrepPatternsBatch(
  content: string,
  ext: string,
  queries: Array<{ rule: AstGrepRule; addedLineNumbers: number[] }>,
  onRuleFailure?: OnRuleFailure,
): AstGrepMatch[][] {
  if (queries.length === 0) return [];

  const lang = extensionToLang(ext);
  if (!lang) {
    return queries.map(() => []);
  }

  const lines = content.split('\n');

  let root: import('@ast-grep/napi').SgRoot;
  try {
    root = parse(lang, content);
  } catch (err) {
    rethrowAsParseError('ast-grep batch parse failed', err, AST_GREP_HINT);
  }

  return queries.map(({ rule, addedLineNumbers }, index) => {
    if (!onRuleFailure) {
      // Legacy path: first failure aborts the whole batch.
      return executeQuery(root, rule, addedLineNumbers, lines);
    }
    try {
      return executeQuery(root, rule, addedLineNumbers, lines);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      onRuleFailure(index, wrapped);
      return [];
    }
  });
}
