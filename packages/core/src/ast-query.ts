import * as fs from 'node:fs';
import * as path from 'node:path';

import { ensureInit, extensionToLanguage, loadGrammar } from './ast-classifier.js';
import type { SupportedLanguage } from './ast-classifier.js';

// ─── Types ──────────────────────────────────────────

export interface AstMatch {
  lineNumber: number;
  lineText: string;
}

// ─── File reading ───────────────────────────────────

/**
 * Read file content — try `git show :path` first (staged content), fall back to disk.
 */
async function readFileContent(filePath: string, cwd: string): Promise<string | null> {
  try {
    const { execFileSync } = await import('node:child_process');
    return execFileSync('git', ['show', `:${filePath}`], { cwd, encoding: 'utf-8' }); // totem-ignore — execFileSync resolves git via PATH, no shell needed
  } catch {
    // Fall back to disk
  }

  try {
    const fullPath = path.resolve(cwd, filePath);
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────

/**
 * Run a Tree-sitter S-expression query against a file and return matches
 * that overlap with the given added line numbers.
 *
 * Fail-open: returns empty array on any error (invalid query, parse failure, etc.).
 */
export async function matchAstQuery(
  filePath: string,
  astQuery: string,
  addedLineNumbers: number[],
  cwd: string,
): Promise<AstMatch[]> {
  if (addedLineNumbers.length === 0) return [];

  // Determine language from extension
  const ext = path.extname(filePath);
  const lang: SupportedLanguage | undefined = extensionToLanguage(ext);
  if (!lang) return []; // Unsupported file type — fail-open

  // Read file content
  const content = await readFileContent(filePath, cwd);
  if (!content) return [];

  const lines = content.split('\n');
  const addedSet = new Set(addedLineNumbers);

  try {
    await ensureInit();
    const grammar = await loadGrammar(lang);

    // Import web-tree-sitter for Parser and Query constructors
    const TreeSitter = await import('web-tree-sitter');
    const ParserClass = TreeSitter.default?.Parser ?? TreeSitter.Parser;
    const QueryClass = TreeSitter.default?.Query ?? TreeSitter.Query;

    const parser = new ParserClass();
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(content);
      if (!tree) return [];

      try {
        // Create the query from the S-expression
        const query = new QueryClass(grammar, astQuery);
        try {
          const matches = query.matches(tree.rootNode);
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

            // Fall back to first capture if no @violation
            if (!targetNode && match.captures.length > 0) {
              targetNode = match.captures[0]!.node;
            }

            if (!targetNode) continue;

            // Tree-sitter uses 0-based rows; convert to 1-based
            const startLine = targetNode.startPosition.row + 1;
            const endLine = targetNode.endPosition.row + 1;

            // Check if any line in the node's range overlaps with added lines
            for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
              if (addedSet.has(lineNum)) {
                const lineText = lines[lineNum - 1] ?? '';
                results.push({
                  lineNumber: lineNum,
                  lineText,
                });
                break; // One match per node is enough
              }
            }
          }

          return results;
        } finally {
          query.delete();
        }
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  } catch {
    // Fail-open: invalid query, parse failure, etc.
    return [];
  }
}
