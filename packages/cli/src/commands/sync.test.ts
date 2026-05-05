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
const mockRequireEmbedding = vi.fn();
vi.mock('../utils.js', () => ({
  resolveConfigPath: (...args: unknown[]) => mockResolveConfigPath(...args),
  isGlobalConfigPath: (...args: unknown[]) => mockIsGlobalConfigPath(...args),
  loadEnv: vi.fn(),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args), // totem-context: mock surface
  requireEmbedding: (...args: unknown[]) => mockRequireEmbedding(...args), // totem-context: mock surface
  sanitize: (s: string) => s,
}));

const mockUpdateRegistryEntry = vi.fn().mockResolvedValue(undefined);
const mockRunSync = vi
  .fn()
  .mockResolvedValue({ chunksProcessed: 10, filesProcessed: 3, totalChunks: 42 });
const mockResolveInstalledPacks = vi.fn().mockReturnValue({ resolved: [], warnings: [] });
const mockWriteInstalledPacksManifest = vi.fn();

// totem-context: full-module mock — syncCommand is the unit under test; importing actual @mmnto/totem would cross the unit boundary into runSync's pipeline-walk side effects. The mock surfaces are call-spied in tests, not invoked for behavior.
vi.mock('@mmnto/totem', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args), // totem-context: mock surface; not a re-implementation of utility logic
  updateRegistryEntry: (...args: unknown[]) => mockUpdateRegistryEntry(...args), // totem-context: mock surface
  resolveInstalledPacks: (...args: unknown[]) => mockResolveInstalledPacks(...args), // totem-context: mock surface
  writeInstalledPacksManifest: (...args: unknown[]) => mockWriteInstalledPacksManifest(...args), // totem-context: mock surface
  TotemError: class TotemError extends Error {
    constructor(
      public code: string,
      message: string,
      public hint?: string,
      // totem-context: mock mirrors real TotemError(code, message, hint, cause) signature for R2 cause-preservation tests
      cause?: unknown,
    ) {
      super(message, { cause });
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
    // totem-context: vitest mock reset in unit-test setup; not an orchestrator timeout candidate
    mockRequireEmbedding.mockReset();
    mockRunSync.mockReset();
    mockRunSync.mockResolvedValue({ chunksProcessed: 10, filesProcessed: 3, totalChunks: 42 });
    mockResolveInstalledPacks.mockReset();
    mockResolveInstalledPacks.mockReturnValue({ resolved: [], warnings: [] });
    mockWriteInstalledPacksManifest.mockReset();
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

  it('writes canonical file relative to cwd when using global config profile', async () => {
    // A user running with ~/.totem/totem.config.ts may still customize
    // review.sourceExtensions. Writing the canonical file into ~/.totem/ would
    // orphan it away from the bash hook (which reads from git-toplevel via
    // `git rev-parse --show-toplevel`). Falling back to cwd hits the common
    // case where the user invokes totem from the repo root. Preserves TS/bash
    // parity for the typical global-config flow.
    mockIsGlobalConfigPath.mockReturnValue(true);
    mockLoadConfig.mockResolvedValue(baseConfig({ review: { sourceExtensions: ['.ts', '.rs'] } }));

    await syncCommand({ quiet: true });

    const canonical = path.join(tmpDir, '.totem', 'review-extensions.txt');
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf-8')).toBe('.ts\n.rs\n');
  });

  // ─── mmnto-ai/totem#1811: Phase A / Phase B split ─────

  // totem-context: test callback genuinely awaits async syncCommand
  it('--packs-only skips runSync and does NOT call requireEmbedding', async () => {
    await syncCommand({ packsOnly: true, quiet: true });
    expect(mockRequireEmbedding).not.toHaveBeenCalled();
    expect(mockRunSync).not.toHaveBeenCalled();
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('--packs-only writes installed-packs.json (Phase A still fires)', async () => {
    await syncCommand({ packsOnly: true, quiet: true });
    expect(mockResolveInstalledPacks).toHaveBeenCalledTimes(1);
    expect(mockWriteInstalledPacksManifest).toHaveBeenCalledTimes(1);
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('--packs-only short-circuits — no spinner, no registry update', async () => {
    await syncCommand({ packsOnly: true, quiet: true });
    expect(mockUpdateRegistryEntry).not.toHaveBeenCalled();
    expect(mockCreateSpinner).not.toHaveBeenCalled();
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('--index-only skips pack-resolution + manifest write but still runs runSync', async () => {
    await syncCommand({ indexOnly: true, quiet: true });
    expect(mockResolveInstalledPacks).not.toHaveBeenCalled();
    expect(mockWriteInstalledPacksManifest).not.toHaveBeenCalled();
    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockRequireEmbedding).toHaveBeenCalledTimes(1);
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('default sync (no flags) runs both Phase A AND Phase B', async () => {
    await syncCommand({ quiet: true });
    expect(mockResolveInstalledPacks).toHaveBeenCalledTimes(1);
    expect(mockWriteInstalledPacksManifest).toHaveBeenCalledTimes(1);
    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockRequireEmbedding).toHaveBeenCalledTimes(1);
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('--packs-only + --index-only is a hard FLAG_CONFLICT error', async () => {
    await expect(syncCommand({ packsOnly: true, indexOnly: true, quiet: true })).rejects.toThrow(
      /--packs-only.*--index-only/,
    );
    expect(mockRequireEmbedding).not.toHaveBeenCalled();
    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockResolveInstalledPacks).not.toHaveBeenCalled();
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('--packs-only + --full is a hard FLAG_CONFLICT error', async () => {
    await expect(syncCommand({ packsOnly: true, full: true, quiet: true })).rejects.toThrow(
      /--packs-only.*--full/,
    );
    expect(mockRunSync).not.toHaveBeenCalled();
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('--packs-only + --prune is a hard FLAG_CONFLICT error', async () => {
    await expect(syncCommand({ packsOnly: true, prune: true, quiet: true })).rejects.toThrow(
      /--packs-only.*--prune/,
    );
    expect(mockRunSync).not.toHaveBeenCalled();
  });

  // totem-context: test callback genuinely awaits async syncCommand — load-bearing CI-unblock guard for --packs-only Phase A failure (#1828); cause preservation per styleguide §6 (R2)
  it('--packs-only throws SYNC_FAILED with original err as cause when Phase A manifest write fails', async () => {
    // totem-context: sentinel error fixture for cause-preservation assertion; not a TotemError-wrapping pattern
    const original = new Error('EACCES: permission denied');
    mockWriteInstalledPacksManifest.mockImplementationOnce(() => {
      // totem-context: throw inside vitest mock to simulate a Phase A write failure; sentinel string is test-only and never surfaces to a user
      throw original;
    });
    // totem-context: test genuinely awaits async syncCommand; rejects.toThrow asserts the SYNC_FAILED message
    await expect(syncCommand({ packsOnly: true, quiet: true })).rejects.toThrow(
      /Failed to write installed-packs\.json/,
    );
    // Re-run to capture the thrown error and assert cause is preserved
    mockWriteInstalledPacksManifest.mockImplementationOnce(() => {
      // totem-context: throw inside vitest mock to assert Error.cause preservation; second-pass check on the same code path
      throw original;
    });
    let caught: unknown;
    try {
      await syncCommand({ packsOnly: true, quiet: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // totem-context: TS type assertion to access Error.cause in test scaffold — not Zod-relevant runtime validation
    expect((caught as Error & { cause?: unknown }).cause).toBe(original);
    expect(mockRunSync).not.toHaveBeenCalled();
  });

  // totem-context: test callback genuinely awaits async syncCommand — regression guard for default-mode warn-and-continue (#1828 review carve-out)
  it('default mode keeps warn-and-continue when Phase A manifest write fails', async () => {
    // totem-context: regression guard — default mode keeps best-effort warn-and-continue while --packs-only throws (sibling test above)
    mockWriteInstalledPacksManifest.mockImplementationOnce(() => {
      // totem-context: throw inside vitest mock to simulate a Phase A write failure; sentinel string is test-only and never surfaces to a user
      throw new Error('EACCES: permission denied');
    });
    await expect(syncCommand({ quiet: true })).resolves.toBeUndefined();
    expect(mockRunSync).toHaveBeenCalledTimes(1);
  });

  // totem-context: test callback genuinely awaits async syncCommand
  it('mutex error fires BEFORE config load and embedder gate', async () => {
    // Load-bearing for the CI-unblock invariant: a mutex violation
    // must not cascade through `requireEmbedding`, which would mask
    // FLAG_CONFLICT behind a TotemConfigError on missing API keys.
    mockRequireEmbedding.mockImplementationOnce(() => {
      // totem-context: throw inside vitest mock to assert mutex fires before requireEmbedding; sentinel string is test-only and never surfaces to a user
      throw new Error('embedding gate fired despite mutex violation');
    });
    await expect(syncCommand({ packsOnly: true, indexOnly: true })).rejects.toThrow(/--packs-only/);
    // totem-context: mutex-fires-before-config invariant (#1828 R2 CR finding); test genuinely awaits async syncCommand
    expect(mockLoadConfig).not.toHaveBeenCalled();
    expect(mockRequireEmbedding).not.toHaveBeenCalled();
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
