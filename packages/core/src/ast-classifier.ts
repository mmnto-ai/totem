import { createRequire } from 'node:module';

import type { AstContext } from './compiler.js';

// ─── Types ──────────────────────────────────────────

/**
 * Tree-sitter language label. The literal union covers built-in languages
 * shipped by core; the `(string & {})` extension admits pack-contributed
 * values (e.g., `'rust'`) registered via `PackRegistrationAPI.registerLanguage`
 * (mmnto-ai/totem#1768). Per ADR-097 § 5 Q3 + § 10 the registry is the
 * runtime source of truth; this type alias keeps IntelliSense on built-in
 * names while admitting any registered string.
 */
export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript' | (string & {});

// ─── Language registry (mmnto-ai/totem#1653 + ADR-097 § 10) ──

/**
 * Extension → language registry. Replaces the `switch` previously in
 * `extensionToLanguage`. Built-in entries register at module load (bottom
 * of this file); pack callbacks register additional entries during boot
 * via `PackRegistrationAPI.registerLanguage` → `registerLang()` here.
 */
const EXT_TO_LANG_REGISTRY = new Map<string, SupportedLanguage>();

/**
 * Language → WASM grammar loader thunk. Replaces the `switch` previously
 * in `loadGrammar`. Loader returns a path string (built-ins use
 * `require.resolve`) or a Buffer (packs embed grammar bytes); web-tree-sitter
 * accepts either. The thunk is invoked lazily on first `loadGrammar(lang)`
 * call and the result is memoized in `grammarCache`.
 */
const LANG_TO_WASM_LOADER = new Map<
  SupportedLanguage,
  () => string | Uint8Array | Promise<string | Uint8Array>
>();

/**
 * Built-in language extensions, immutable. A pack attempting to re-register
 * one of these is rejected at the boundary in `registerLang()`.
 */
const BUILTIN_EXTENSIONS = new Set<string>();
const BUILTIN_LANGUAGES = new Set<SupportedLanguage>();

let langRegistrySealed = false;

// ─── Lazy-loaded Tree-sitter state ──────────────────

let Parser: typeof import('web-tree-sitter').Parser | null = null;
let initPromise: Promise<void> | null = null;

const grammarCache = new Map<SupportedLanguage, import('web-tree-sitter').Language>();

/**
 * Initialize web-tree-sitter WASM engine. Idempotent — safe to call multiple times.
 */
export async function ensureInit(): Promise<void> {
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
 * Load a Tree-sitter grammar WASM for the given language. Resolves the
 * language's WASM source via the registry (`LANG_TO_WASM_LOADER`) — built-in
 * loaders use `require.resolve(...)` against tree-sitter-typescript /
 * tree-sitter-javascript; pack-registered loaders return paths to the
 * pack's bundled WASM (per ADR-097 Q2 — WASM bundling decision). The
 * loader thunk is invoked lazily here on first dispatch and the resolved
 * grammar is memoized in `grammarCache`.
 *
 * Throws when the language is not registered. ast-grep dispatch path
 * (`rule-engine.ts`) is fail-loud per mmnto-ai/totem#1653 — silent skip on
 * unmapped extensions was the bug.
 */
export async function loadGrammar(
  lang: SupportedLanguage,
): Promise<import('web-tree-sitter').Language> {
  const cached = grammarCache.get(lang);
  if (cached) return cached;

  const loader = LANG_TO_WASM_LOADER.get(lang);
  if (!loader) {
    throw new Error(
      `No WASM grammar loader registered for language '${lang}'. Either install the pack that provides it or correct the language reference.`,
    );
  }

  await ensureInit();
  const TreeSitter = await import('web-tree-sitter');
  const LanguageClass = TreeSitter.default?.Language ?? TreeSitter.Language;

  const wasmSource = await loader();
  const grammar = await LanguageClass.load(wasmSource);
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
      const lines = content.split('\n');

      for (const lineNum of lineNumbers) {
        // Tree-sitter uses 0-based rows
        const row = lineNum - 1;
        // Get the named node at the start of this line (skip leading whitespace)
        const lineText = lines[row];
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
 * Map file extension to a registered Tree-sitter language.
 *
 * Registry-backed per ADR-097 § 10 + mmnto-ai/totem#1653. Built-in entries
 * (`.ts`/`.tsx`/`.jsx`/`.js`/`.mjs`/`.cjs`) self-register at module load
 * (bottom of this file). Pack callbacks add entries during boot via
 * `PackRegistrationAPI.registerLanguage`.
 *
 * Returns undefined when the extension isn't registered. The dispatch
 * path in `rule-engine.ts` treats undefined as fail-loud per #1653 — the
 * silent skip behavior pre-#1653 was a bug.
 */
export function extensionToLanguage(ext: string): SupportedLanguage | undefined {
  return EXT_TO_LANG_REGISTRY.get(ext.toLowerCase());
}

// ─── Language registry public surface (mmnto-ai/totem#1653 + #1768) ──

/**
 * Register a (extension, language, wasmLoader) triple. Called by built-ins
 * at module load and by Pack registration callbacks during boot via
 * `PackRegistrationAPI.registerLanguage` (mmnto-ai/totem#1768). Throws when:
 *
 * - The registry is sealed (boot-time-only mutation).
 * - The extension is already registered to a different language (built-in
 *   entries are immutable; pack-vs-pack collisions also rejected).
 * - The language is already registered to a different WASM loader.
 *
 * Both maps are updated together: an extension always points at a language
 * that has a known WASM loader. Partial registration (extension without
 * loader) is rejected.
 */
export function registerLang(
  extension: string,
  lang: SupportedLanguage,
  wasmLoader: () => string | Uint8Array | Promise<string | Uint8Array>,
): void {
  if (langRegistrySealed) {
    throw new Error(
      `Language registration after engine seal: tried to register '${extension}' → '${lang}' but engine has already started serving requests. Pack registration must complete during boot — see ADR-097 § 5 Q5.`,
    );
  }
  const normalizedExt = extension.toLowerCase();
  const existingLang = EXT_TO_LANG_REGISTRY.get(normalizedExt);
  if (existingLang !== undefined && existingLang !== lang) {
    const existingIsBuiltin = BUILTIN_EXTENSIONS.has(normalizedExt);
    throw new Error(
      `Extension '${normalizedExt}' is already registered to language '${existingLang}'${existingIsBuiltin ? ' as a built-in (built-in entries are immutable)' : ' (pack-vs-pack collision)'}; refusing to re-register to '${lang}'.`,
    );
  }
  const existingLoader = LANG_TO_WASM_LOADER.get(lang);
  if (existingLoader !== undefined && existingLoader !== wasmLoader) {
    const existingIsBuiltin = BUILTIN_LANGUAGES.has(lang);
    throw new Error(
      `Language '${lang}' is already registered with a WASM loader${existingIsBuiltin ? ' as a built-in (built-in entries are immutable)' : ' (pack-vs-pack collision)'}; refusing to override.`,
    );
  }
  EXT_TO_LANG_REGISTRY.set(normalizedExt, lang);
  LANG_TO_WASM_LOADER.set(lang, wasmLoader);
}

/**
 * Snapshot of currently-registered extensions. Used for fail-loud error
 * messages on unmapped extensions and `totem describe` output.
 */
export function registeredExtensions(): readonly string[] {
  return [...EXT_TO_LANG_REGISTRY.keys()].sort();
}

/**
 * Snapshot of currently-registered languages. Stable order for deterministic
 * output.
 */
export function registeredLanguages(): readonly SupportedLanguage[] {
  return [...LANG_TO_WASM_LOADER.keys()].sort();
}

/** True iff the extension is built-in (vs pack-registered). */
export function isBuiltinExtension(ext: string): boolean {
  return BUILTIN_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Mark the language registry as sealed. After this, `registerLang()`
 * calls throw. Called by `pack-discovery.ts` `loadInstalledPacks()` after
 * every pack callback returns.
 */
export function sealLangRegistry(): void {
  langRegistrySealed = true;
}

/** True iff the language registry has been sealed. */
export function isLangRegistrySealed(): boolean {
  return langRegistrySealed;
}

// ─── Test-only helpers ──────────────────────────────

/**
 * Test-only: reset the language registry and re-register built-ins. Lets
 * per-test fixtures register without leaking state across tests.
 */
export function __resetLangRegistryForTests(): void {
  EXT_TO_LANG_REGISTRY.clear();
  LANG_TO_WASM_LOADER.clear();
  BUILTIN_EXTENSIONS.clear();
  BUILTIN_LANGUAGES.clear();
  langRegistrySealed = false;
  grammarCache.clear();
  registerBuiltinLanguages();
}

/** Test-only: clear the seal so subsequent registrations succeed. */
export function __unsealLangRegistryForTests(): void {
  langRegistrySealed = false;
}

// ─── Built-in language registration (runs at module load) ──

function registerBuiltinLang(
  extension: string,
  lang: SupportedLanguage,
  wasmLoader: () => string,
): void {
  BUILTIN_EXTENSIONS.add(extension.toLowerCase());
  BUILTIN_LANGUAGES.add(lang);
  registerLang(extension, lang, wasmLoader);
}

function registerBuiltinLanguages(): void {
  const require = createRequire(import.meta.url);
  // Loaders are de-duplicated by reference: when multiple extensions map
  // to the same language, they MUST share the same loader instance so the
  // "language already registered with a different loader" guard in
  // `registerLang()` doesn't trip on the second extension's registration.
  const tsLoader = () => require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
  const tsxLoader = () => require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
  const jsLoader = () => require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');

  registerBuiltinLang('.ts', 'typescript', tsLoader);
  registerBuiltinLang('.tsx', 'tsx', tsxLoader);
  // TSX grammar handles JSX — same loader instance as '.tsx'.
  registerBuiltinLang('.jsx', 'tsx', tsxLoader);
  registerBuiltinLang('.js', 'javascript', jsLoader);
  registerBuiltinLang('.mjs', 'javascript', jsLoader);
  registerBuiltinLang('.cjs', 'javascript', jsLoader);
}

registerBuiltinLanguages();
