import { createRequire } from 'node:module';
import * as path from 'node:path';

import { Lang, parse } from '@ast-grep/napi';
import { describe, expect, it, vi } from 'vitest';

import type { PackRegistrationAPI } from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

describe('@totem/pack-rust-architecture napi side-channel', () => {
  it('register.cjs side-channel makes parse(rust, ...) work after invocation (mmnto-ai/totem#1774 v0.1 pattern)', () => {
    const mod = require(PACK_ROOT) as {
      default?: (api: PackRegistrationAPI) => void;
    };
    const register = mod.default;
    if (typeof register !== 'function') {
      throw new Error('register is not a function');
    }

    // Run the pack's registration. The side-channel inside register.cjs
    // calls @ast-grep/napi.registerDynamicLanguage({ rust }) — after this
    // returns, parse('rust', source) must succeed.
    const api: PackRegistrationAPI = {
      registerChunkStrategy: vi.fn(),
      registerLanguage: vi.fn(),
    };
    register(api);

    const root = parse('rust' as unknown as Lang, 'fn main() { let x = 1; }');
    expect(root.root().kind()).toBe('source_file');
  });

  it('side-channel registration is idempotent — repeat invocation is a no-op', () => {
    const mod = require(PACK_ROOT) as {
      default?: (api: PackRegistrationAPI) => void;
    };
    const register = mod.default!;
    const api: PackRegistrationAPI = {
      registerChunkStrategy: vi.fn(),
      registerLanguage: vi.fn(),
    };

    // Call twice — must not throw on the second invocation.
    register(api);
    register(api);

    const root = parse('rust' as unknown as Lang, 'struct Foo;');
    expect(root.root().kind()).toBe('source_file');
  });
});
