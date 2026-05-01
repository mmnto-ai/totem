import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { PackRegistrationAPI, SupportedLanguage } from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

describe('@totem/pack-rust-architecture register.cjs', () => {
  it('default-exports a synchronous register callback', () => {
    const mod = require(PACK_ROOT) as {
      default?: unknown;
      register?: unknown;
    };
    expect(typeof mod.default === 'function' || typeof mod.register === 'function').toBe(true);
  });

  it('registers .rs → rust with a wasmLoader resolving to the bundled WASM path', () => {
    const mod = require(PACK_ROOT) as {
      default?: (api: PackRegistrationAPI) => void;
    };
    const register = mod.default;
    if (typeof register !== 'function') {
      throw new Error('register is not a function');
    }

    const registerLanguage = vi.fn();
    const api: PackRegistrationAPI = {
      registerChunkStrategy: vi.fn(),
      registerLanguage,
    };

    register(api);

    expect(registerLanguage).toHaveBeenCalledTimes(1);
    const call = registerLanguage.mock.calls[0] as [
      string,
      SupportedLanguage,
      () => string | Uint8Array | Promise<string | Uint8Array>,
    ];
    const [extension, lang, wasmLoader] = call;
    expect(extension).toBe('.rs');
    expect(lang).toBe('rust');

    const resolved = wasmLoader();
    expect(typeof resolved).toBe('string');
    expect(resolved).toBe(path.join(PACK_ROOT, 'tree-sitter-rust.wasm'));
    expect(fs.existsSync(resolved as string)).toBe(true);
  });

  it('returns synchronously (no Promise) — ADR-097 § 5 Q5 contract', () => {
    const mod = require(PACK_ROOT) as {
      default?: (api: PackRegistrationAPI) => unknown;
    };
    const register = mod.default;
    if (typeof register !== 'function') {
      throw new Error('register is not a function');
    }

    const api: PackRegistrationAPI = {
      registerChunkStrategy: vi.fn(),
      registerLanguage: vi.fn(),
    };
    const result = register(api);
    expect(result).toBeUndefined();
  });
});
