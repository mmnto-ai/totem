import { Lang, parse } from '@ast-grep/napi';

// ─── Types ──────────────────────────────────────────

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

// ─── Public API ─────────────────────────────────────

/**
 * Run an ast-grep pattern against file content, filtering to added lines.
 * Returns matches where at least one line in the match range is an added line.
 * Fails open — returns empty array on parse errors or unsupported languages.
 */
export function matchAstGrepPattern(
  content: string,
  ext: string,
  pattern: string,
  addedLineNumbers: number[],
): AstGrepMatch[] {
  const results = matchAstGrepPatternsBatch(content, ext, [{ pattern, addedLineNumbers }]);
  return results.get(pattern) ?? [];
}

/**
 * Parse a file once and run multiple ast-grep patterns against it.
 * O(M + N) — file parsed exactly once regardless of rule count.
 */
export function matchAstGrepPatternsBatch(
  content: string,
  ext: string,
  queries: Array<{ pattern: string; addedLineNumbers: number[] }>,
): Map<string, AstGrepMatch[]> {
  const results = new Map<string, AstGrepMatch[]>();
  if (queries.length === 0) return results;

  const lang = extensionToLang(ext);
  if (!lang) {
    for (const q of queries) results.set(q.pattern, []);
    return results;
  }

  const lines = content.split('\n');

  try {
    const root = parse(lang, content).root();

    for (const { pattern, addedLineNumbers } of queries) {
      if (addedLineNumbers.length === 0) {
        results.set(pattern, []);
        continue;
      }

      const addedSet = new Set(addedLineNumbers);
      try {
        const matches = root.findAll(pattern);
        const patternResults: AstGrepMatch[] = [];

        for (const match of matches) {
          const startLine = match.range().start.line + 1;
          const endLine = match.range().end.line + 1;

          for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
            if (addedSet.has(lineNum)) {
              patternResults.push({
                lineNumber: lineNum,
                lineText: lines[lineNum - 1] ?? '',
              });
              break;
            }
          }
        }

        results.set(pattern, patternResults);
      } catch {
        results.set(pattern, []);
      }
    }

    return results;
  } catch {
    for (const q of queries) results.set(q.pattern, []);
    return results;
  }
}
