/**
 * WASM compatibility shim for @ast-grep/napi.
 *
 * This module is aliased in place of @ast-grep/napi during the esbuild lite build.
 * It re-exports the same API surface that ast-grep-query.ts uses, backed by
 * @ast-grep/wasm instead of native NAPI bindings.
 *
 * NOT imported in the normal build — only used via esbuild alias in the lite binary.
 */

import { createRequire } from 'node:module';

// ─── Types ──────────────────────────────────────────

/**
 * Compatible NapiConfig type — ast-grep compound rule config.
 * The WASM API accepts the same shape as `any` matcher argument.
 */
export type NapiConfig = {
  rule: Record<string, unknown>;
  constraints?: Record<string, Record<string, unknown>>;
  language?: string;
  utils?: Record<string, Record<string, unknown>>;
};

// ─── Lang enum (string-valued to match WASM API) ───

/**
 * Mimics the @ast-grep/napi Lang enum.
 * The WASM API uses plain strings; the napi API uses a numeric enum.
 * This object provides the same property names with string values.
 */
export const Lang = {
  TypeScript: 'typescript',
  Tsx: 'tsx',
  JavaScript: 'javascript',
  Html: 'html',
  Css: 'css',
} as const;

export type Lang = (typeof Lang)[keyof typeof Lang];

// ─── Lazy initialization ────────────────────────────

let initPromise: Promise<void> | null = null;
let initialized = false;

// We store the WASM module reference after dynamic import
let wasmModule: typeof import('@ast-grep/wasm') | null = null;

/**
 * Initialize the WASM runtime and register JS/TS language parsers.
 * Must be called (and awaited) before the first `parse()` call.
 * Safe to call multiple times — initialization happens only once.
 */
export async function ensureInit(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = doInit();
  await initPromise;
}

async function doInit(): Promise<void> {
  // Dynamic import so this module can be bundled by esbuild
  // even when @ast-grep/wasm is resolved at build time
  const mod = await import('@ast-grep/wasm');
  wasmModule = mod;

  // Initialize the tree-sitter WASM runtime
  await mod.initializeTreeSitter();

  // Locate tree-sitter language WASM files via require.resolve
  // In the bundled binary, these paths resolve to embedded assets
  const req = createRequire(import.meta.url);

  let tsWasm: string;
  let tsxWasm: string;
  let jsWasm: string;

  try {
    tsWasm = req.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
    tsxWasm = req.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
    jsWasm = req.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
  } catch {
    // In the compiled Bun binary, require.resolve may not work.
    // Fall back to looking relative to the binary location.
    const { join, dirname } = await import('node:path');
    const wasmDir = join(dirname(process.execPath), 'wasm');
    tsWasm = join(wasmDir, 'tree-sitter-typescript.wasm');
    tsxWasm = join(wasmDir, 'tree-sitter-tsx.wasm');
    jsWasm = join(wasmDir, 'tree-sitter-javascript.wasm');
  }

  // Register the languages we support
  await mod.registerDynamicLanguage({
    typescript: { libraryPath: tsWasm },
    tsx: { libraryPath: tsxWasm },
    javascript: { libraryPath: jsWasm },
  });

  initialized = true;
}

// ─── Public API (matching @ast-grep/napi) ───────────

/**
 * Parse source code into an AST.
 * Matches the @ast-grep/napi signature: parse(lang: Lang, src: string) => SgRoot
 *
 * The lang parameter accepts either a Lang enum value (string) or the
 * numeric napi Lang values — we normalize to strings internally.
 */
export function parse(lang: Lang | string, src: string): import('@ast-grep/wasm').SgRoot {
  if (!initialized || !wasmModule) {
    throw new Error('[Totem Lite] AST engine not initialized. Call ensureInit() before parse().');
  }

  // Normalize lang — in case someone passes the string directly
  const langStr = typeof lang === 'string' ? lang : String(lang);

  return wasmModule.parse(langStr, src);
}
