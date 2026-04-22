import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-proposal-'));
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

describe('proposalNewCommand', () => {
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

  it('creates 001-feature-branch-workflow.md for standalone strategy repo', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { proposalNewCommand } = await import('./proposal.js');
    await proposalNewCommand('Feature Branch Workflow', { cwd: tmpDir });

    const filePath = path.join(tmpDir, 'proposals', 'active', '001-feature-branch-workflow.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Proposal 001: Feature Branch Workflow');
    expect(content).toContain('**Status:** Draft');

    // Summary line surfaced via stderr log.success.
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Scaffolded');
    expect(output).toContain('001-feature-branch-workflow.md');
  });

  it('creates file under submodule .strategy/ when present', async () => {
    initGit(tmpDir);
    const strategyDir = path.join(tmpDir, '.strategy');
    fs.mkdirSync(path.join(strategyDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(strategyDir, 'adr'), { recursive: true });

    const { proposalNewCommand } = await import('./proposal.js');
    await proposalNewCommand('Ingestion Pipeline', { cwd: tmpDir });

    const filePath = path.join(strategyDir, 'proposals', 'active', '001-ingestion-pipeline.md');
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
