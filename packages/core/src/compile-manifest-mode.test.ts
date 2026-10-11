import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompileManifest } from './compile-manifest.js';
import { writeCompileManifest } from './compile-manifest.js';
import { writeFileAtomicSync } from './fs-atomic.js';
import { cleanTmpDir } from './test-utils.js';

// ─── writeCompileManifest passes a mode only on create (mmnto-ai/totem#3036) ──
//
// The atomic helper applies an explicit mode on EVERY write, where the old
// in-place writeFileSync applied its mode only at creation. The manifest writer
// therefore passes `mode` only when the manifest does not exist yet, so an
// existing manifest keeps its own bits. Mode bits are not measurable on win32,
// so this arm reads the options the writer hands the helper, on every platform.

vi.mock('./fs-atomic.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./fs-atomic.js')>();
  return { ...real, writeFileAtomicSync: vi.fn(real.writeFileAtomicSync) };
});

const MANIFEST: CompileManifest = {
  compiled_at: '2026-10-10T02:18:13.000Z',
  model: 'm',
  input_hash: 'a'.repeat(64),
  output_hash: 'b'.repeat(64),
  rule_count: 1,
};

describe('writeCompileManifest mode arms', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-manifest-mode-'));
    vi.mocked(writeFileAtomicSync).mockClear();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates a new manifest with mode 0644', () => {
    const p = path.join(tmpDir, 'compile-manifest.json');
    writeCompileManifest(p, MANIFEST);
    expect(vi.mocked(writeFileAtomicSync)).toHaveBeenCalledWith(
      p,
      JSON.stringify(MANIFEST, null, 2) + '\n',
      { mode: 0o644 },
    );
  });

  it('writes over an existing manifest with no mode, so it keeps its own bits', () => {
    const p = path.join(tmpDir, 'compile-manifest.json');
    fs.writeFileSync(p, '{}\n', 'utf-8');
    writeCompileManifest(p, MANIFEST);
    expect(vi.mocked(writeFileAtomicSync)).toHaveBeenCalledWith(
      p,
      JSON.stringify(MANIFEST, null, 2) + '\n',
      {},
    );
  });
});
