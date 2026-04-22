import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-adr-'));
}

function initGit(dir: string): void {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
  fs.writeFileSync(
    path.join(dir, '.git', 'config'),
    '[core]\n\trepositoryformatversion = 0\n',
    'utf-8',
  );
  fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true });
}

/** Stub `safeExec` so the hooks run without spawning real subprocesses. */
vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: vi.fn((_cmd: string, _args: string[]) => ''),
  };
});

describe('adrNewCommand', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('creates 001-database-sharding.md with ADR-091 heading format', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { adrNewCommand } = await import('./adr.js');
    await adrNewCommand('Database Sharding', { cwd: tmpDir });

    const filePath = path.join(tmpDir, 'adr', '001-database-sharding.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    // ADR-091: `# ADR NNN: Title` with SPACE separator, not a hyphen.
    expect(content).toContain('# ADR 001: Database Sharding');
    expect(content).not.toContain('# ADR-001');
    expect(content).toContain('**Status:** Draft');

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Scaffolded');
    expect(output).toContain('001-database-sharding.md');
  });

  it('respects gap numbering in adr/ directory', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'adr', '001-alpha.md'), '# a\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'adr', '004-beta.md'), '# b\n', 'utf-8');

    const { adrNewCommand } = await import('./adr.js');
    await adrNewCommand('Charlie', { cwd: tmpDir });

    // Gap logic: max=4, next=005.
    const filePath = path.join(tmpDir, 'adr', '005-charlie.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# ADR 005: Charlie');
  });
});
