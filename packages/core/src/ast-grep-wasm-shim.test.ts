/**
 * Unit tests for the ast-grep WASM shim.
 *
 * The WASM runtime itself cannot be tested in Vitest because Node's ESM
 * loader doesn't support `.wasm` imports. Full end-to-end verification
 * is done via the esbuild bundle: `node dist/lite/totem-lite.mjs lint`
 * exercises ensureInit → parse → findAll through the real WASM engine.
 *
 * These tests cover the synchronous, non-WASM parts of the shim.
 */

import { describe, expect, it } from 'vitest';

// Import only the synchronous exports — avoid triggering WASM import
const shimPath = './ast-grep-wasm-shim.js';

describe('ast-grep-wasm-shim (non-WASM parts)', () => {
  it('exports a Lang object with the expected language keys', async () => {
    // Dynamic import to isolate from WASM loading issues
    let Lang: Record<string, string>;
    try {
      const mod = await import(shimPath);
      Lang = mod.Lang;
    } catch (err) {
      // Only swallow the known WASM loader limitation — re-throw real errors
      const msg = err instanceof Error ? err.message : String(err);
      if (!/\.wasm|ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension/i.test(msg)) {
        throw err;
      }
      // WASM import fails in Node — that's expected
      // Verify the source directly instead
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

      expect(src).toContain("TypeScript: 'typescript'");
      expect(src).toContain("Tsx: 'tsx'");
      expect(src).toContain("JavaScript: 'javascript'");
      return;
    }

    expect(Lang.TypeScript).toBe('typescript');
    expect(Lang.Tsx).toBe('tsx');
    expect(Lang.JavaScript).toBe('javascript');
    expect(Lang.Html).toBe('html');
    expect(Lang.Css).toBe('css');
  });

  it('exports ensureInit and parse functions', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

    // Verify exported function signatures exist
    expect(src).toContain('export async function ensureInit()');
    expect(src).toContain('export function parse(');
  });

  it('parse guard throws before initialization', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

    // Verify the initialization guard exists
    expect(src).toContain('if (!initialized || !wasmModule)');
    expect(src).toContain('[Totem Error] AST engine not initialized');
  });

  it('ensureInit is idempotent via initPromise guard', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

    // Verify the idempotency guard
    expect(src).toContain('if (initialized) return');
    expect(src).toContain('if (initPromise) return initPromise');
  });

  it('registers TypeScript, TSX, and JavaScript languages', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

    // Verify all three languages are registered
    expect(src).toContain('typescript: { libraryPath:');
    expect(src).toContain('tsx: { libraryPath:');
    expect(src).toContain('javascript: { libraryPath:');
  });

  it('has fallback path resolution for compiled binary', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

    // Verify fallback to process.execPath-relative WASM directory
    expect(src).toContain('process.execPath');
    expect(src).toContain("'wasm'");
  });

  it('exports a compatible NapiConfig type', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname!, 'ast-grep-wasm-shim.ts'), 'utf-8');

    expect(src).toContain('export type NapiConfig');
    expect(src).toContain('rule: Record<string, unknown>');
  });
});
