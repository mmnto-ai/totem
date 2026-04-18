import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const mockCreateSpinner = vi.fn();

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
  createSpinner: (...args: unknown[]) => mockCreateSpinner(...args),
}));

const mockLoadConfig = vi.fn();
const mockResolveConfigPath = vi.fn();
const mockIsGlobalConfigPath = vi.fn();
vi.mock('../utils.js', () => ({
  resolveConfigPath: (...args: unknown[]) => mockResolveConfigPath(...args),
  isGlobalConfigPath: (...args: unknown[]) => mockIsGlobalConfigPath(...args),
  loadEnv: vi.fn(),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  requireEmbedding: vi.fn(),
}));

const mockUpdateRegistryEntry = vi.fn().mockResolvedValue(undefined);

vi.mock('@mmnto/totem', () => ({
  runSync: vi.fn().mockResolvedValue({ chunksProcessed: 10, filesProcessed: 3, totalChunks: 42 }),
  updateRegistryEntry: (...args: unknown[]) => mockUpdateRegistryEntry(...args),
  TotemError: class TotemError extends Error {
    constructor(
      public code: string,
      message: string,
      public hint?: string,
    ) {
      super(message);
    }
  },
}));

import { syncCommand, writeReviewExtensionsFile } from './sync.js';

const baseConfig = (overrides: Record<string, unknown> = {}) => ({
  targets: [],
  totemDir: '.totem',
  lanceDir: '.lancedb',
  ignorePatterns: [],
  embedding: { provider: 'openai', model: 'text-embedding-3-small' },
  review: { sourceExtensions: ['.ts', '.tsx', '.js', '.jsx'] },
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────

describe('syncCommand', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-sync-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    mockLoadConfig.mockReset();
    mockLoadConfig.mockResolvedValue(baseConfig());
    mockResolveConfigPath.mockReset();
    mockIsGlobalConfigPath.mockReset();
    // Default: config lives next to wherever the user invoked totem from.
    // Individual tests override to exercise cwd !== configRoot scenarios.
    mockResolveConfigPath.mockImplementation((cwd: unknown) =>
      path.join(String(cwd), 'totem.config.ts'),
    );
    mockIsGlobalConfigPath.mockReturnValue(false);
    mockCreateSpinner.mockResolvedValue({
      update: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    });
  });

  afterEach(() => {
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    vi.clearAllMocks();
  });

  it('creates a spinner when quiet is not set', async () => {
    await syncCommand({});
    expect(mockCreateSpinner).toHaveBeenCalledTimes(1);
    expect(mockCreateSpinner).toHaveBeenCalledWith('Sync', 'Incremental sync...');
  });

  it('creates a spinner when quiet is false', async () => {
    await syncCommand({ quiet: false });
    expect(mockCreateSpinner).toHaveBeenCalledTimes(1);
  });

  it('does NOT create a spinner when quiet is true', async () => {
    await syncCommand({ quiet: true });
    expect(mockCreateSpinner).not.toHaveBeenCalled();
  });

  it('uses full re-index label when full is true', async () => {
    await syncCommand({ full: true });
    expect(mockCreateSpinner).toHaveBeenCalledWith('Sync', 'Full re-index...');
  });

  it('still completes sync successfully when quiet is true', async () => {
    // Should not throw
    await expect(syncCommand({ quiet: true })).resolves.toBeUndefined();
  });

  it('calls updateRegistryEntry after successful sync', async () => {
    await syncCommand({});
    expect(mockUpdateRegistryEntry).toHaveBeenCalledTimes(1);
    expect(mockUpdateRegistryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkCount: 42,
        embedder: expect.any(String),
        lastSync: expect.any(String),
        path: expect.any(String),
      }),
    );
  });

  it('survives registry update failure without breaking sync', async () => {
    mockUpdateRegistryEntry.mockRejectedValueOnce(new Error('EACCES'));
    await expect(syncCommand({})).resolves.toBeUndefined();
  });

  // ─── #1527: canonical review-extensions.txt write ─────

  it('writes newline-separated source extensions to .totem/review-extensions.txt on sync', async () => {
    mockLoadConfig.mockResolvedValue(
      baseConfig({ review: { sourceExtensions: ['.ts', '.tsx', '.rs', '.gd'] } }),
    );
    await syncCommand({ quiet: true });
    const canonical = path.join(tmpDir, '.totem', 'review-extensions.txt');
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf-8')).toBe('.ts\n.tsx\n.rs\n.gd\n');
  });

  it('writes default extensions when review.sourceExtensions is omitted', async () => {
    // config.review is defaulted by Zod — simulate the parsed form with defaults applied.
    mockLoadConfig.mockResolvedValue(
      baseConfig({ review: { sourceExtensions: ['.ts', '.tsx', '.js', '.jsx'] } }),
    );
    await syncCommand({ quiet: true });
    const canonical = path.join(tmpDir, '.totem', 'review-extensions.txt');
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf-8')).toBe('.ts\n.tsx\n.js\n.jsx\n');
  });

  it('survives canonical-file write failure without breaking sync', async () => {
    // Seed a directory in the target path so mkdirSync succeeds but writeFileSync collides
    // with a directory-not-file error. (Platform-portable way to force failure: make
    // review-extensions.txt a directory.)
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.mkdirSync(path.join(totemDir, 'review-extensions.txt'));
    await expect(syncCommand({ quiet: true })).resolves.toBeUndefined();
  });

  it('skips canonical file write when using global config profile', async () => {
    // A user running with only ~/.totem/totem.config.ts has no local project
    // to wire the bash hook to; writing the canonical file into their home
    // directory would be worse than useless. Bash hook falls back to defaults.
    mockIsGlobalConfigPath.mockReturnValue(true);
    await syncCommand({ quiet: true });
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'review-extensions.txt'))).toBe(false);
  });

  it('resolves canonical file path relative to configRoot when invoked from subdirectory', async () => {
    // Simulates a monorepo user running `totem sync` from a subdirectory such as
    // packages/cli/ while totem.config.ts lives at the repo root. The canonical
    // file must land at <project-root>/.totem/review-extensions.txt, matching
    // what shield.ts and the bash PreToolUse hook read. Resolving against cwd
    // would orphan the file under the subdirectory (lesson 61975bb96c9bf27f).
    const subdir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subdir, { recursive: true });
    process.chdir(subdir);

    // resolveConfigPath walks up from cwd and finds the config at the repo root.
    mockResolveConfigPath.mockReturnValue(path.join(tmpDir, 'totem.config.ts'));
    mockLoadConfig.mockResolvedValue(baseConfig({ review: { sourceExtensions: ['.ts', '.rs'] } }));

    await syncCommand({ quiet: true });

    // Canonical file lands at configRoot, never under the invoking subdirectory.
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'review-extensions.txt'))).toBe(true);
    expect(fs.existsSync(path.join(subdir, '.totem', 'review-extensions.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, '.totem', 'review-extensions.txt'), 'utf-8')).toBe(
      '.ts\n.rs\n',
    );
  });
});

describe('writeReviewExtensionsFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-sync-helper-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('creates the directory if missing', () => {
    const nested = path.join(tmpDir, 'nested', '.totem');
    writeReviewExtensionsFile(nested, ['.ts']);
    expect(fs.existsSync(path.join(nested, 'review-extensions.txt'))).toBe(true);
  });

  it('writes one extension per line with trailing newline', () => {
    writeReviewExtensionsFile(tmpDir, ['.ts', '.rs']);
    expect(fs.readFileSync(path.join(tmpDir, 'review-extensions.txt'), 'utf-8')).toBe('.ts\n.rs\n');
  });

  it('atomically replaces existing file content', () => {
    writeReviewExtensionsFile(tmpDir, ['.ts']);
    writeReviewExtensionsFile(tmpDir, ['.rs', '.gd']);
    expect(fs.readFileSync(path.join(tmpDir, 'review-extensions.txt'), 'utf-8')).toBe('.rs\n.gd\n');
  });

  it('leaves no .tmp residue after successful write', () => {
    writeReviewExtensionsFile(tmpDir, ['.ts', '.tsx']);
    const files = fs.readdirSync(tmpDir);
    expect(files).toContain('review-extensions.txt');
    expect(files).not.toContain('review-extensions.txt.tmp');
  });
});
