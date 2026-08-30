/**
 * `resolveEjectTotemDir` — the value `totem eject` DELETES (mmnto-ai/totem#2692
 * C5, amendment A6). Eject removes the repo's configured Totem directory; a
 * value that names the checkout itself or escapes it must never be honoured,
 * because the consumer is `fs.rmSync(path.join(cwd, dir), { recursive: true })`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  DEFAULT_TOTEM_DIR,
  looksLikeTotemDir,
  resolveEjectTotemDir,
  TOTEM_DIR_ENTRIES,
} from './eject.js';

const BASE_TARGETS =
  'targets:\n  - glob: "docs/*.md"\n    type: lesson\n    strategy: markdown-heading\n';

describe('resolveEjectTotemDir — never the checkout, never outside it (A6)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eject-dir-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function writeConfig(totemDirLine: string): void {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), `${BASE_TARGETS}${totemDirLine}`, 'utf-8');
  }

  it('honours a repo-local totemDir inside the checkout', async () => {
    writeConfig('totemDir: knowledge\n');
    expect(await resolveEjectTotemDir(tmpDir)).toBe('knowledge');
  });

  it('normalises a trailing slash (the schema does; eject agrees)', async () => {
    writeConfig('totemDir: .totem/\n');
    expect(await resolveEjectTotemDir(tmpDir)).toBe('.totem');
  });

  it.each([
    ['the checkout itself', 'totemDir: "."\n'],
    ['a parent-escaping path', 'totemDir: a/../..\n'],
    ['an empty value (the schema refuses it, so the config will not load)', 'totemDir: ""\n'],
  ])('falls back to the default for %s', async (_label, line) => {
    writeConfig(line);
    expect(await resolveEjectTotemDir(tmpDir)).toBe(DEFAULT_TOTEM_DIR);
  });

  it('falls back to the default when the repo has no config of its own', async () => {
    // With no local config the resolver either lands on the global profile
    // (guarded by isGlobalConfigPath) or throws (caught) — the default either way,
    // and never the profile's own `totemDir: '.'`.
    expect(await resolveEjectTotemDir(tmpDir)).toBe(DEFAULT_TOTEM_DIR);
  });

  it('never resolves to a path outside the checkout', async () => {
    for (const line of ['totemDir: knowledge\n', 'totemDir: a/b\n', 'totemDir: ./x\n']) {
      writeConfig(line);
      const dir = await resolveEjectTotemDir(tmpDir);
      const joined = path.resolve(tmpDir, dir);
      expect(joined.startsWith(path.resolve(tmpDir) + path.sep), dir).toBe(true);
    }
  });

  it('a repo-local config that will not load is a LOUD default, not a silent one', async () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: [oh no: {', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await resolveEjectTotemDir(tmpDir)).toBe(DEFAULT_TOTEM_DIR);
      const lines = [...errorSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.join(' '));
      expect(lines.some((l) => l.includes('Could not load') && l.includes('totem.yaml'))).toBe(
        true,
      );
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('looksLikeTotemDir — the ownership gate before a recursive delete', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eject-own-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('recognises a directory holding any Totem-written entry', () => {
    for (const entry of ['lessons', 'cache', 'compiled-rules.json', 'prepare.cjs']) {
      const dir = path.join(tmpDir, `own-${entry.replace(/\W/g, '_')}`);
      fs.mkdirSync(dir, { recursive: true });
      if (entry.includes('.')) fs.writeFileSync(path.join(dir, entry), '');
      else fs.mkdirSync(path.join(dir, entry));
      expect(looksLikeTotemDir(dir), entry).toBe(true);
    }
    expect(TOTEM_DIR_ENTRIES).toContain('lessons');
  });

  it('refuses an ordinary project directory, an empty one, and a missing one', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'index.ts'), 'export {};\n');
    expect(looksLikeTotemDir(src)).toBe(false);
    const empty = path.join(tmpDir, 'empty');
    fs.mkdirSync(empty);
    expect(looksLikeTotemDir(empty)).toBe(false);
    expect(looksLikeTotemDir(path.join(tmpDir, 'missing'))).toBe(false);
  });
});
