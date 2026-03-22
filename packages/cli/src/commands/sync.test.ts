import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const mockCreateSpinner = vi.fn();

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
  createSpinner: (...args: unknown[]) => mockCreateSpinner(...args),
}));

vi.mock('../utils.js', () => ({
  resolveConfigPath: vi.fn().mockReturnValue('/fake/totem.config.ts'),
  loadEnv: vi.fn(),
  loadConfig: vi.fn().mockResolvedValue({
    targets: [],
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    embedding: { provider: 'openai', model: 'text-embedding-3-small' },
  }),
  requireEmbedding: vi.fn(),
}));

vi.mock('@mmnto/totem', () => ({
  runSync: vi.fn().mockResolvedValue({ chunksProcessed: 10, filesProcessed: 3 }),
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

import { syncCommand } from './sync.js';

// ─── Tests ──────────────────────────────────────────────

describe('syncCommand', () => {
  beforeEach(() => {
    mockCreateSpinner.mockResolvedValue({
      update: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    });
  });

  afterEach(() => {
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
});
