/**
 * `resolveEjectTotemDir` — the value `totem eject` DELETES (mmnto-ai/totem#2692
 * C5, amendment A6). Eject removes the repo's configured Totem directory; a
 * value that names the checkout itself or escapes it must never be honoured,
 * because the consumer is `fs.rmSync(path.join(cwd, dir), { recursive: true })`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { DEFAULT_TOTEM_DIR, resolveEjectTotemDir } from './eject.js';

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
});
