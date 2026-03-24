import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────

const mockReadRegistry = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('@mmnto/totem', () => ({
  readRegistry: (...args: unknown[]) => mockReadRegistry(...args),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

import { formatRelativeTime, listCommand } from './list.js';

// ─── Tests ──────────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('returns seconds for < 60s', () => {
    expect(formatRelativeTime(5000)).toBe('5s ago');
  });

  it('returns minutes for < 60m', () => {
    expect(formatRelativeTime(3 * 60 * 1000)).toBe('3m ago');
  });

  it('returns hours for < 24h', () => {
    expect(formatRelativeTime(5 * 60 * 60 * 1000)).toBe('5h ago');
  });

  it('returns days for >= 24h', () => {
    expect(formatRelativeTime(3 * 24 * 60 * 60 * 1000)).toBe('3d ago');
  });

  it('returns 0s for 0ms', () => {
    expect(formatRelativeTime(0)).toBe('0s ago');
  });
});

describe('listCommand', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    stderrSpy.mockRestore();
  });

  it('prints "No workspaces" when registry is empty', () => {
    mockReadRegistry.mockReturnValue({});

    listCommand();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces registered'));
  });

  it('prints workspace entries', () => {
    mockReadRegistry.mockReturnValue({
      '/projects/foo': {
        path: '/projects/foo',
        chunkCount: 42,
        lastSync: new Date().toISOString(),
        embedder: 'openai/1536d',
      },
    });

    listCommand();

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('/projects/foo');
    expect(output).toContain('Chunks: 42');
    expect(output).toContain('openai/1536d');
  });

  it('flags entries older than 30 days as [STALE]', () => {
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    mockReadRegistry.mockReturnValue({
      '/projects/old': {
        path: '/projects/old',
        chunkCount: 10,
        lastSync: staleDate,
        embedder: 'openai/1536d',
      },
    });

    listCommand();

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('[STALE]');
  });

  it('does not flag recent entries as [STALE]', () => {
    mockReadRegistry.mockReturnValue({
      '/projects/fresh': {
        path: '/projects/fresh',
        chunkCount: 10,
        lastSync: new Date().toISOString(),
        embedder: 'openai/1536d',
      },
    });

    listCommand();

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).not.toContain('[STALE]');
  });

  it('flags non-existent paths as [MISSING]', () => {
    mockExistsSync.mockReturnValue(false);
    mockReadRegistry.mockReturnValue({
      '/projects/gone': {
        path: '/projects/gone',
        chunkCount: 10,
        lastSync: new Date().toISOString(),
        embedder: 'openai/1536d',
      },
    });

    listCommand();

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('[MISSING]');
  });

  it('sorts entries by lastSync descending', () => {
    const older = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const newer = new Date().toISOString();
    mockReadRegistry.mockReturnValue({
      '/projects/old': {
        path: '/projects/old',
        chunkCount: 10,
        lastSync: older,
        embedder: 'openai/1536d',
      },
      '/projects/new': {
        path: '/projects/new',
        chunkCount: 20,
        lastSync: newer,
        embedder: 'openai/1536d',
      },
    });

    listCommand();

    // Find the calls that contain project paths
    const pathCalls = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((s: string) => s.includes('/projects/'));

    const newIdx = pathCalls.findIndex((s: string) => s.includes('/projects/new'));
    const oldIdx = pathCalls.findIndex((s: string) => s.includes('/projects/old'));
    expect(newIdx).toBeLessThan(oldIdx);
  });
});
