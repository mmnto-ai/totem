import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { docsCommand } from './docs.js';

// ─── Mocks ──────────────────────────────────────────────

vi.mock('../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveConfigPath: vi.fn().mockReturnValue('/fake/totem.config.ts'),
    loadEnv: vi.fn(),
    loadConfig: vi.fn(),
    runOrchestrator: vi.fn().mockReturnValue('# Updated README\n\nNew content here.\n'),
    getSystemPrompt: vi.fn().mockReturnValue('system prompt'),
    writeOutput: vi.fn(),
  };
});

vi.mock('../git.js', () => ({
  getLatestTag: vi.fn().mockReturnValue('v0.14.0'),
  getGitLogSince: vi.fn().mockReturnValue('abc1234 feat: new feature\ndef5678 fix: bug fix'),
  isFileDirty: vi.fn().mockReturnValue(false),
}));

vi.mock('../adapters/github-cli.js', () => ({
  GitHubCliAdapter: vi.fn().mockImplementation(() => ({
    fetchClosedIssues: vi
      .fn()
      .mockReturnValue([
        { number: 108, title: 'Clean up temp files', closedAt: '2026-03-06T00:00:00Z' },
      ]),
  })),
}));

import { loadConfig, runOrchestrator } from '../utils.js';
import { isFileDirty } from '../git.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDir: string;

function setupTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'totem-docs-test-'));
  // Create docs directory and active_work.md
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'active_work.md'), '# Active Work\n', 'utf-8');
  return dir;
}

function writeDoc(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

// ─── Tests ──────────────────────────────────────────────

describe('docsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset return values (clearAllMocks only clears call records, not implementations)
    vi.mocked(isFileDirty).mockReturnValue(false);
    vi.mocked(runOrchestrator).mockReturnValue('# Updated README\n\nNew content here.\n');
    tmpDir = setupTmpDir();
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when no docs configured', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    await expect(docsCommand({})).rejects.toThrow('No docs configured');
  });

  it('throws when docs array is empty', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    await expect(docsCommand({})).rejects.toThrow('No docs configured');
  });

  it('throws when --only matches no docs', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [{ path: 'README.md', description: 'readme', trigger: 'post-release' }],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    await expect(docsCommand({ only: 'nonexistent' })).rejects.toThrow(
      "--only 'nonexistent' matched no configured docs",
    );
  });

  it('filters docs with --only', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [
        { path: 'README.md', description: 'readme', trigger: 'post-release' },
        { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' },
      ],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');

    await docsCommand({ only: 'readme' });

    // Only one orchestrator call (for README.md)
    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('throws when target file has uncommitted changes', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [{ path: 'README.md', description: 'readme', trigger: 'post-release' }],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    vi.mocked(isFileDirty).mockReturnValue(true);

    await expect(docsCommand({})).rejects.toThrow('uncommitted changes');
  });

  it('allows dirty files in --dry-run mode', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [{ path: 'README.md', description: 'readme', trigger: 'post-release' }],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    vi.mocked(isFileDirty).mockReturnValue(true);
    writeDoc(tmpDir, 'README.md', '# Old README\n');

    // Should not throw
    await docsCommand({ dryRun: true });
    expect(runOrchestrator).toHaveBeenCalledTimes(1);

    // File should NOT be modified in dry-run
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toBe('# Old README\n');
  });

  it('writes updated content to disk', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [{ path: 'README.md', description: 'readme', trigger: 'post-release' }],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    await docsCommand({});

    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('Updated README');
  });

  it('skips files that do not exist', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [{ path: 'nonexistent.md', description: 'missing', trigger: 'post-release' }],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    // Should not throw — just skip
    await docsCommand({});
    expect(runOrchestrator).not.toHaveBeenCalled();
  });

  it('processes multiple docs sequentially', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      docs: [
        { path: 'README.md', description: 'readme', trigger: 'post-release' },
        { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' },
      ],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
      contextWarningThreshold: 40_000,
    });

    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');

    await docsCommand({});

    expect(runOrchestrator).toHaveBeenCalledTimes(2);
  });
});
