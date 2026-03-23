import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { SupportedLanguage } from './ast-classifier.js';
import { ensureInit, extensionToLanguage, loadGrammar } from './ast-classifier.js';
import { rethrowAsParseError } from './errors.js';

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────

export interface AstMatch {
  lineNumber: number;
  lineText: string;
}

// ─── Constants ──────────────────────────────────────

const TREE_SITTER_HINT =
  'Check the S-expression query syntax. If valid, the source file may contain syntax that crashes tree-sitter.';

// ─── File reading ───────────────────────────────────

/**
 * Read file content — try `git show :path` first (staged content), fall back to disk.
 * Fully async — does not block the event loop.
 */
async function readFileContent(filePath: string, cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `:${filePath}`], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB safety cap
    });
    return stdout;
  } catch {
    // Fall back to disk
  }

  try {
    const fullPath = path.resolve(cwd, filePath);
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

// ─── Query execution ────────────────────────────────

/**
 * Run a single S-expression query against a parsed tree.
 * Returns matches that overlap with added line numbers.
 */
function runQuery(
  QueryClass: new (
    lang: import('web-tree-sitter').Language,
    source: string,
  ) => import('web-tree-sitter').Query,
  grammar: import('web-tree-sitter').Language,
  rootNode: import('web-tree-sitter').Node,
  lines: string[],
  astQuery: string,
  addedLineNumbers: Set<number>,
): AstMatch[] {
  let query: import('web-tree-sitter').Query | null = null;
  try {
    query = new QueryClass(grammar, astQuery);
    const matches = query.matches(rootNode);
    const results: AstMatch[] = [];

    for (const match of matches) {
      // Find the @violation capture, or use the first capture
      let targetNode: import('web-tree-sitter').Node | null = null;

      for (const capture of match.captures) {
        if (capture.name === 'violation') {
          targetNode = capture.node;
          break;
        }
      }

      if (!targetNode && match.captures.length > 0) {
        targetNode = match.captures[0]!.node;
      }

      if (!targetNode) continue;

      const startLine = targetNode.startPosition.row + 1;
      const endLine = targetNode.endPosition.row + 1;

      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        if (addedLineNumbers.has(lineNum)) {
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
    /* c8 ignore next – rethrowAsParseError always throws; return satisfies TS2366 */
    return rethrowAsParseError('AST query failed', err, TREE_SITTER_HINT);
  } finally {
    query?.delete();
  }
}

// ─── Public API ─────────────────────────────────────

/**
 * Convenience wrapper: read + parse + query in one call.
 * For batch operations, use `matchAstQueriesBatch` instead.
 */
export async function matchAstQuery(
  filePath: string,
  astQuery: string,
  addedLineNumbers: number[],
  cwd: string,
): Promise<AstMatch[]> {
  if (addedLineNumbers.length === 0) return [];

  const ext = path.extname(filePath);
  const lang: SupportedLanguage | undefined = extensionToLanguage(ext);
  if (!lang) return [];

  const content = await readFileContent(filePath, cwd);
  if (!content) return [];

  try {
    await ensureInit();
    const grammar = await loadGrammar(lang);

    const TreeSitter = await import('web-tree-sitter');
    const ParserClass = TreeSitter.default?.Parser ?? TreeSitter.Parser;
    const QueryClass = TreeSitter.default?.Query ?? TreeSitter.Query;

    const parser = new ParserClass();
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(content);
      if (!tree) return [];

      try {
        return runQuery(
          QueryClass,
          grammar,
          tree.rootNode,
          content.split('\n'),
          astQuery,
          new Set(addedLineNumbers),
        );
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  } catch (err) {
    rethrowAsParseError('AST parse failed', err, TREE_SITTER_HINT);
  }
}

/**
 * Parse a file once and run multiple AST queries against it efficiently.
 * O(M + N) instead of O(M * N) — file is read and parsed exactly once.
 * Returns results indexed by position in the input array.
 */
export async function matchAstQueriesBatch(
  filePath: string,
  queries: Array<{ astQuery: string; addedLineNumbers: number[] }>,
  cwd: string,
): Promise<AstMatch[][]> {
  if (queries.length === 0) return [];

  const ext = path.extname(filePath);
  const lang: SupportedLanguage | undefined = extensionToLanguage(ext);
  if (!lang) {
    return queries.map(() => []);
  }

  const content = await readFileContent(filePath, cwd);
  if (!content) {
    return queries.map(() => []);
  }

  try {
    await ensureInit();
    const grammar = await loadGrammar(lang);

    const TreeSitter = await import('web-tree-sitter');
    const ParserClass = TreeSitter.default?.Parser ?? TreeSitter.Parser;
    const QueryClass = TreeSitter.default?.Query ?? TreeSitter.Query;

    const parser = new ParserClass();
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(content);
      if (!tree) {
        return queries.map(() => []);
      }

      const lines = content.split('\n');

      try {
        return queries.map(({ astQuery, addedLineNumbers }) =>
          runQuery(QueryClass, grammar, tree.rootNode, lines, astQuery, new Set(addedLineNumbers)),
        );
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  } catch (err) {
    rethrowAsParseError('AST batch parse failed', err, TREE_SITTER_HINT);
  }
}
