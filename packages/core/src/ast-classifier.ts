import { createRequire } from 'node:module';

import type { AstContext } from './compiler.js';

// ─── Types ──────────────────────────────────────────

export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript';

interface ClassifiedLine {
  lineNumber: number;
  context: AstContext; // totem-ignore
}

// ─── Lazy-loaded Tree-sitter state ──────────────────

let Parser: typeof import('web-tree-sitter').Parser | null = null;
let initPromise: Promise<void> | null = null;

const grammarCache = new Map<SupportedLanguage, import('web-tree-sitter').Language>();

/**
 * Initialize web-tree-sitter WASM engine. Idempotent — safe to call multiple times.
 */
async function ensureInit(): Promise<void> {
  if (Parser) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const TreeSitter = await import('web-tree-sitter');
    const ParserClass = TreeSitter.default?.Parser ?? TreeSitter.Parser;
    const require = createRequire(import.meta.url);

    // Locate the WASM engine file
    const wasmPath = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
    await ParserClass.init({ locateFile: () => wasmPath });
    Parser = ParserClass;
  })();

  return initPromise;
}

/**
 * Load a Tree-sitter grammar WASM file for the given language.
 */
async function loadGrammar(lang: SupportedLanguage): Promise<import('web-tree-sitter').Language> {
  const cached = grammarCache.get(lang);
  if (cached) return cached;

  await ensureInit();
  const TreeSitter = await import('web-tree-sitter');
  const LanguageClass = TreeSitter.default?.Language ?? TreeSitter.Language;

  const require = createRequire(import.meta.url);
  let wasmFile: string;

  switch (lang) {
    case 'typescript':
      wasmFile = require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
      break;
    case 'tsx':
      wasmFile = require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
      break;
    case 'javascript':
      wasmFile = require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
      break;
  }

  const grammar = await LanguageClass.load(wasmFile);
  grammarCache.set(lang, grammar);
  return grammar;
}

// ─── Node type classification ───────────────────────

/** Tree-sitter node types that represent string literals */
const STRING_NODE_TYPES = new Set([
  'string',
  'template_string',
  'string_fragment',
  'template_literal_type',
]);

/** Tree-sitter node types that represent comments */
const COMMENT_NODE_TYPES = new Set(['comment']);

/** Tree-sitter node types that represent regex literals */
const REGEX_NODE_TYPES = new Set(['regex', 'regex_pattern']);

/**
 * Walk the AST ancestry from a node to determine its syntactic context.
 * Returns the deepest enclosing string/comment/regex context, or 'code'.
 */
function classifyNode(node: import('web-tree-sitter').Node): AstContext {
  let current: import('web-tree-sitter').Node | null = node;

  while (current) {
    if (STRING_NODE_TYPES.has(current.type)) return 'string';
    if (COMMENT_NODE_TYPES.has(current.type)) return 'comment';
    if (REGEX_NODE_TYPES.has(current.type)) return 'regex';
    current = current.parent;
  }

  return 'code';
}

// ─── Public API ─────────────────────────────────────

/**
 * Classify specific lines of source code by their AST context.
 *
 * @param content - Full file content (used for parsing)
 * @param lineNumbers - 1-based line numbers to classify
 * @param language - Language to parse as
 * @returns Map from line number to AstContext
 */
export async function classifyLines(
  content: string,
  lineNumbers: number[],
  language: SupportedLanguage,
): Promise<Map<number, AstContext>> {
  const result = new Map<number, AstContext>();
  if (lineNumbers.length === 0) return result;

  await ensureInit();

  const grammar = await loadGrammar(language);
  const parser = new Parser!();
  try {
    parser.setLanguage(grammar);
    const tree = parser.parse(content);
    if (!tree) {
      // Parse failed — fail-open, leave all lines unclassified
      return result;
    }

    try {
      const rootNode = tree.rootNode;

      for (const lineNum of lineNumbers) {
        // Tree-sitter uses 0-based rows
        const row = lineNum - 1;
        // Get the named node at the start of this line (skip leading whitespace)
        const lineText = content.split('\n')[row];
        if (lineText === undefined) continue;

        const col = lineText.length - lineText.trimStart().length;
        const node = rootNode.descendantForPosition({ row, column: col });
        if (!node) continue;

        // If the node is an ERROR node, classify as 'code' (fail-open)
        if (node.type === 'ERROR' || node.hasError) {
          result.set(lineNum, 'code');
          continue;
        }

        result.set(lineNum, classifyNode(node));
      }
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }

  return result;
}

/**
 * Map file extension to a supported Tree-sitter language.
 * Returns undefined for unsupported extensions.
 */
export function extensionToLanguage(ext: string): SupportedLanguage | undefined {
  switch (ext.toLowerCase()) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'tsx'; // TSX grammar handles JSX
    default:
      return undefined;
  }
}
