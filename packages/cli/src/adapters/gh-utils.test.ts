import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { safeExec } from '@mmnto/totem';

import { ghExec, ghFetchAndParse, handleGhError } from './gh-utils.js';

// Mock `safeExec` at the `@mmnto/totem` boundary rather than at its
// internal `cross-spawn.sync` call site. mmnto/totem#1329 replaced
// `execFileSync` with `cross-spawn.sync` inside safeExec, and the
// previous test strategy (mocking `node:child_process.execFileSync`)
// stopped intercepting safeExec's new internal primitive. Mocking the
// package boundary is also more appropriately scoped — gh-utils tests
// should verify gh-utils's call signature, not safeExec's passthrough
// layer.
vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: vi.fn(),
  };
});

const mockedExec = vi.mocked(safeExec);

// ─── handleGhError ──────────────────────────────────────

describe('handleGhError', () => {
  it('re-throws errors with [Totem Error] prefix as-is', () => {
    const err = new Error('[Totem Error] Something went wrong');
    expect(() => handleGhError(err, 'test')).toThrow('[Totem Error] Something went wrong');
  });

  it('wraps ZodErrors with context', () => {
    const err = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['title'],
        message: 'Expected string',
      },
    ]);
    expect(() => handleGhError(err, 'issue #42')).toThrow(
      '[Totem Error] Failed to parse GitHub issue #42',
    );
  });

  it('detects ENOENT as missing gh CLI', () => {
    const err = new Error('ENOENT');
    expect(() => handleGhError(err, 'test')).toThrow('[Totem Error] GitHub CLI (gh) is required');
  });

  it('detects ENOENT from safeExec error chain (cause wrapping)', () => {
    const cause = new Error('spawn gh ENOENT');
    const wrapper = new Error('Command failed: gh repo view', { cause });
    expect(() => handleGhError(wrapper, 'test')).toThrow(
      '[Totem Error] GitHub CLI (gh) is required',
    );
  });

  it('wraps unknown errors with context', () => {
    const err = new Error('connection refused');
    expect(() => handleGhError(err, 'open PRs')).toThrow(
      '[Totem Error] Failed to fetch open PRs: connection refused',
    );
  });

  it('handles non-Error values', () => {
    expect(() => handleGhError('string error', 'test')).toThrow(
      '[Totem Error] Failed to fetch test: string error',
    );
  });

  it('detects 403 as rate limit error', () => {
    const err = new Error('HTTP 403: rate limit exceeded');
    expect(() => handleGhError(err, 'PRs')).toThrow('[Totem Error] GitHub API rate limit exceeded');
  });

  it('detects 429 as rate limit error', () => {
    const err = new Error('HTTP 429: Too Many Requests');
    expect(() => handleGhError(err, 'PRs')).toThrow('[Totem Error] GitHub API rate limit exceeded');
  });
});

// ─── ghExec ─────────────────────────────────────────────

describe('ghExec', () => {
  it('uses shared exec options with GH_PROMPT_DISABLED', () => {
    mockedExec.mockReturnValue('');
    ghExec(['issue', 'comment', '1', '-b', 'test'], '/cwd');
    expect(mockedExec).toHaveBeenCalledWith(
      'gh',
      ['issue', 'comment', '1', '-b', 'test'],
      expect.objectContaining({
        env: expect.objectContaining({ GH_PROMPT_DISABLED: '1' }),
      }),
    );
  });
});

// ─── ghFetchAndParse ────────────────────────────────────

const TestSchema = z.object({ id: z.number(), name: z.string() });

describe('ghFetchAndParse', () => {
  it('returns parsed and validated data on success', () => {
    mockedExec.mockReturnValue(JSON.stringify({ id: 1, name: 'test' }));
    const result = ghFetchAndParse(['test', 'cmd'], TestSchema, 'test item', '/cwd');
    expect(result).toEqual({ id: 1, name: 'test' });
  });

  it('passes correct args to safeExec', () => {
    mockedExec.mockReturnValue(JSON.stringify({ id: 1, name: 'test' }));
    ghFetchAndParse(['pr', 'list', '--state', 'open'], TestSchema, 'test', '/cwd');
    expect(mockedExec).toHaveBeenCalledWith(
      'gh',
      ['pr', 'list', '--state', 'open'],
      expect.objectContaining({ cwd: '/cwd' }),
    );
  });

  it('throws on invalid JSON', () => {
    mockedExec.mockReturnValue('not json');
    expect(() => ghFetchAndParse(['test'], TestSchema, 'test item', '/cwd')).toThrow(
      '[Totem Error] GitHub CLI returned invalid JSON for test item',
    );
  });

  it('throws on schema validation failure', () => {
    mockedExec.mockReturnValue(JSON.stringify({ id: 'not-a-number', name: 'test' }));
    expect(() => ghFetchAndParse(['test'], TestSchema, 'test item', '/cwd')).toThrow(
      '[Totem Error] Failed to parse GitHub test item',
    );
  });

  it('throws install message when gh is not found', () => {
    mockedExec.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => ghFetchAndParse(['test'], TestSchema, 'test', '/cwd')).toThrow(
      'GitHub CLI (gh) is required',
    );
  });

  it('wraps unexpected errors with context', () => {
    mockedExec.mockImplementation(() => {
      throw new Error('timeout exceeded');
    });
    expect(() => ghFetchAndParse(['test'], TestSchema, 'PR #5', '/cwd')).toThrow(
      /\[Totem Error\] Failed to fetch PR #5:.*timeout exceeded/,
    );
  });

  it('sets GH_PROMPT_DISABLED to prevent interactive auth hangs', () => {
    mockedExec.mockReturnValue(JSON.stringify({ id: 1, name: 'test' }));
    ghFetchAndParse(['issue', 'view', '1'], TestSchema, 'issue #1', '/cwd');
    expect(mockedExec).toHaveBeenCalledWith(
      'gh',
      ['issue', 'view', '1'],
      expect.objectContaining({ env: expect.objectContaining({ GH_PROMPT_DISABLED: '1' }) }),
    );
  });
});
