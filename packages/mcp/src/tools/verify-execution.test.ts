import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;

/** Controls what the mock spawn does. */
let mockSpawnExitCode = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';
let mockSpawnError: Error | null = null;

/** Controls what execFileSync returns for git diff --name-only. */
let mockUnstagedFiles = '';
let mockExecFileSyncThrows = false;

/**
 * Controls which lock file names are considered to exist.
 * Uses basenames (e.g. 'pnpm-lock.yaml') to avoid cross-platform path issues.
 */
let existingLockFiles: Set<string> = new Set();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

vi.mock('../context.js', () => ({
  getContext: vi.fn(async () => ({
    projectRoot: '/fake/project',
    config: { totemDir: '.totem', lanceDir: '.totem/.lance' },
  })),
}));

vi.mock('../xml-format.js', () => ({
  formatXmlResponse: vi.fn((_tag: string, msg: string) => msg),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const mockExistsSync = vi.fn((p: string) => {
    // Match by basename to avoid platform-dependent path separator issues
    const base = String(p).split(/[\\/]/).pop() ?? '';
    return existingLockFiles.has(base);
  });
  return {
    ...actual,
    default: { ...actual, existsSync: mockExistsSync },
    existsSync: mockExistsSync,
  };
});

vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');
  return {
    execFileSync: vi.fn(() => {
      if (mockExecFileSyncThrows) {
        throw new Error('git not found');
      }
      return mockUnstagedFiles;
    }),
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.pid = 12345;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();

      if (mockSpawnError) {
        const err = mockSpawnError;
        setTimeout(() => child.emit('error', err), 0);
        return child;
      }

      setTimeout(() => {
        if (mockSpawnStdout) {
          child.stdout.emit('data', Buffer.from(mockSpawnStdout));
        }
        if (mockSpawnStderr) {
          child.stderr.emit('data', Buffer.from(mockSpawnStderr));
        }
        child.emit('close', mockSpawnExitCode);
      }, 0);

      return child;
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks are in place)
// ---------------------------------------------------------------------------

import { registerVerifyExecution } from './verify-execution.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): (args: Record<string, unknown>) => Promise<unknown> {
  const fakeServer = {
    registerTool: (_name: string, _opts: unknown, handler: unknown) => {
      capturedHandler = handler as (args: Record<string, unknown>) => Promise<unknown>;
    },
  };
  registerVerifyExecution(fakeServer as never);
  return capturedHandler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verify_execution', () => {
  let handle: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
    mockSpawnError = null;
    mockUnstagedFiles = '';
    mockExecFileSyncThrows = false;
    existingLockFiles = new Set();
    vi.clearAllMocks();
    handle = setup();
  });

  // --- Successful verification ---

  it('returns PASS when lint succeeds with no issues', async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'All checks passed.';

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain('Verification: PASS');
    expect(result.content[0]!.text).toContain('All checks passed.');
  });

  it('returns FAIL when lint finds violations', async () => {
    mockSpawnExitCode = 1;
    mockSpawnStdout = 'Rule xyz violated in src/foo.ts:12';

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Verification: FAIL');
    expect(result.content[0]!.text).toContain('Rule xyz violated');
  });

  // --- Command detection ---

  it('uses pnpm when pnpm-lock.yaml exists', async () => {
    existingLockFiles = new Set(['pnpm-lock.yaml']);
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: true });

    // Find the last spawn call (earlier tests may have called spawn too)
    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('pnpm');
    expect(lastCall[1]).toEqual(expect.arrayContaining(['exec', 'totem', 'lint', '--staged']));
  });

  it('uses yarn when yarn.lock exists (no pnpm-lock.yaml)', async () => {
    existingLockFiles = new Set(['yarn.lock']);
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: false });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('yarn');
    expect(lastCall[1]).toEqual(expect.arrayContaining(['totem', 'lint']));
  });

  it('uses npx when no lock file exists', async () => {
    existingLockFiles = new Set();
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: true });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('npx');
    expect(lastCall[1]).toEqual(expect.arrayContaining(['totem', 'lint', '--staged']));
  });

  it('does not include --staged flag when staged_only is false', async () => {
    existingLockFiles = new Set(['pnpm-lock.yaml']);
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: false });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('pnpm');
    expect(lastCall[1]).toEqual(['exec', 'totem', 'lint']);
  });

  // --- Output capture and truncation ---

  it('captures both stdout and stderr', async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'stdout content';
    mockSpawnStderr = 'stderr content';

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0]!.text).toContain('stdout content');
    expect(result.content[0]!.text).toContain('stderr content');
  });

  it('truncates output exceeding MAX_OUTPUT_CHARS', async () => {
    // Create output larger than 10,000 chars
    mockSpawnStdout = 'x'.repeat(15_000);
    mockSpawnExitCode = 0;

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
    };

    // The output in the result should be truncated at or below 10,000 chars
    // (the source truncates captured chunks to MAX_OUTPUT_CHARS)
    const outputText = result.content[0]!.text;
    // The full text includes "Verification: PASS\n\n" prefix plus the captured output
    const capturedPart = outputText.replace('Verification: PASS\n\n', '');
    expect(capturedPart.length).toBeLessThanOrEqual(10_000);
  });

  // --- Unstaged changes warning ---

  it('warns about unstaged changes when running staged-only', async () => {
    mockUnstagedFiles = 'src/foo.ts\nsrc/bar.ts';
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'All checks passed.';

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0]!.text).toContain('WARNING');
    expect(result.content[0]!.text).toContain('unstaged changes');
    expect(result.content[0]!.text).toContain('src/foo.ts');
  });

  it('does not warn about unstaged changes when not staged-only', async () => {
    mockUnstagedFiles = 'src/foo.ts';
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'All checks passed.';

    const result = (await handle({ staged_only: false })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0]!.text).not.toContain('WARNING');
    expect(result.content[0]!.text).not.toContain('unstaged changes');
  });

  // --- Error handling ---

  it('handles spawn error gracefully', async () => {
    mockSpawnError = new Error('ENOENT: totem not found');

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Verification: FAIL');
    expect(result.content[0]!.text).toContain('Lint spawn error');
  });

  it('handles context initialization failure', async () => {
    // Override getContext to throw for this test
    const contextMock = await import('../context.js');
    vi.mocked(contextMock.getContext).mockRejectedValueOnce(new Error('Config missing'));

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('[Totem Error]');
    expect(result.content[0]!.text).toContain('Config missing');
  });

  it('silently ignores git diff failures for unstaged check', async () => {
    mockExecFileSyncThrows = true;
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'All checks passed.';

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    // Should not contain any warning, and should still pass
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain('Verification: PASS');
    expect(result.content[0]!.text).not.toContain('WARNING');
  });
});
