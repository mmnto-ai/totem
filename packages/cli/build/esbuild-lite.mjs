/**
 * esbuild configuration for the Totem Lite standalone binary.
 *
 * Bundles the lite CLI entry point with:
 * - @ast-grep/napi aliased to the WASM shim (keeps AST engine alive)
 * - @lancedb/lancedb aliased to a stub (no vector store in lite)
 * - LLM SDKs marked as external (not needed)
 * - jiti marked as external (no .ts config loading in lite)
 * - web-tree-sitter WASM files copied to output directory
 */

import { build } from 'esbuild';
import { readFileSync, cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, '..');
const coreRoot = resolve(__dirname, '../../core');
// Resolve from core package context (where WASM deps live)
const coreRequire = createRequire(resolve(coreRoot, 'package.json'));

// Read version from CLI package.json
const { version } = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf-8'));

// Resolve shim paths
const lancedbShim = resolve(__dirname, 'shims/lancedb.js');
const wasmShim = resolve(coreRoot, 'src/ast-grep-wasm-shim.ts');

// Resolve WASM asset paths for tree-sitter (deps are in core, not cli)
const webTreeSitterWasm = coreRequire.resolve('web-tree-sitter/web-tree-sitter.wasm');
const tsWasm = coreRequire.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
const tsxWasm = coreRequire.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
const jsWasm = coreRequire.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
const astGrepWasm = resolve(
  dirname(coreRequire.resolve('@ast-grep/wasm/package.json')),
  'wasm_bg.wasm',
);

/**
 * Plugin to alias native deps to shims and handle WASM imports.
 */
const nativeShimsPlugin = {
  name: 'native-shims',
  setup(build) {
    // Alias @lancedb/lancedb to the stub
    build.onResolve({ filter: /^@lancedb\/lancedb$/ }, () => ({
      path: lancedbShim,
    }));

    // Alias @ast-grep/napi to the WASM shim
    build.onResolve({ filter: /^@ast-grep\/napi$/ }, () => ({
      path: wasmShim,
    }));

    // apache-arrow is only used via LanceDB — stub it
    build.onResolve({ filter: /^apache-arrow/ }, () => ({
      path: lancedbShim,
    }));
  },
};

const outdir = resolve(cliRoot, 'dist/lite');

await build({
  entryPoints: [resolve(cliRoot, 'src/index-lite.ts')],
  bundle: true,
  outfile: resolve(outdir, 'totem-lite.mjs'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  treeShaking: true,

  // LLM SDKs and config loader — not available in lite
  // Node builtins must be external for ESM bundles
  external: [
    'openai',
    '@anthropic-ai/sdk',
    '@google/genai',
    'jiti',
    'typescript',
    // Node.js built-in modules
    'node:*',
    'child_process',
    'crypto',
    'events',
    'fs',
    'http',
    'https',
    'module',
    'net',
    'os',
    'path',
    'process',
    'readline',
    'stream',
    'string_decoder',
    'tls',
    'tty',
    'url',
    'util',
    'worker_threads',
    'zlib',
    'assert',
    'buffer',
    'dns',
    'perf_hooks',
    'querystring',
    'vm',
  ],

  plugins: [nativeShimsPlugin],

  define: {
    __TOTEM_VERSION__: JSON.stringify(version),
  },

  // Handle .wasm imports as files (esbuild copies them)
  loader: { '.wasm': 'file' },

  // Provide a real `require` for CJS modules bundled into ESM output.
  // Without this, esbuild's CJS shim throws "Dynamic require not supported".
  banner: {
    js: "import { createRequire as __totemCreateRequire } from 'node:module'; const require = __totemCreateRequire(import.meta.url);",
  },
});

// Copy tree-sitter WASM assets to output directory so the binary can embed them.
// Note: @ast-grep/wasm's own wasm_bg.wasm is emitted by esbuild's file loader as a
// hash-named file (e.g. wasm_bg-<hash>.wasm) and referenced by the bundle directly —
// we do NOT copy astGrepWasm manually, as that would create an orphaned duplicate
// (~1.8 MB) that nothing in the fallback path at ast-grep-wasm-shim.ts references.
// See strategy proposal 214 for the investigation.
mkdirSync(resolve(outdir, 'wasm'), { recursive: true });
cpSync(webTreeSitterWasm, resolve(outdir, 'wasm/web-tree-sitter.wasm'));
cpSync(tsWasm, resolve(outdir, 'wasm/tree-sitter-typescript.wasm'));
cpSync(tsxWasm, resolve(outdir, 'wasm/tree-sitter-tsx.wasm'));
cpSync(jsWasm, resolve(outdir, 'wasm/tree-sitter-javascript.wasm'));

console.log(`[Lite Build] Bundled to ${resolve(outdir, 'totem-lite.mjs')}`);
console.log(`[Lite Build] Version: ${version}`);
console.log(`[Lite Build] WASM assets copied to ${resolve(outdir, 'wasm/')}`);
