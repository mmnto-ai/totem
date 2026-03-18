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
  if (addedLineNumbers.length === 0) return [];

  const lang = extensionToLang(ext);
  if (!lang) return [];

  const addedSet = new Set(addedLineNumbers);
  const lines = content.split('\n');

  try {
    const root = parse(lang, content).root();
    const matches = root.findAll(pattern);
    const results: AstGrepMatch[] = [];

    for (const match of matches) {
      const startLine = match.range().start.line + 1; // 0-based to 1-based
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
    // Fail-open on invalid pattern or parse failure
    return [];
  }
}
