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

/** The absolute CLI entry the mocked resolver returns on a hit. */
const FAKE_ENTRY = '/fake/project/node_modules/@mmnto/cli/dist/index.js';
const RESOLVED_HIT = {
  ok: true as const,
  entry: FAKE_ENTRY,
  version: '9.9.9',
  tier: 'pinned' as const,
};
const LOOKED = [
  'a workspace build at packages/cli/dist/index.js, walking up from /fake/project',
  'a pinned install at node_modules/@mmnto/cli/dist/index.js, walking up from /fake/project',
  'an npm-layout global install of @mmnto/cli on PATH',
];
/** What the mocked core resolver returns (mmnto-ai/totem#3008). */
let mockResolution: unknown = RESOLVED_HIT;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

// The light core subpath the spawn resolves through; the barrel stays out of
// this file, as for the context mock below.
vi.mock('@mmnto/totem/cli-resolve', () => ({
  resolveTotemCli: vi.fn(() => mockResolution),
}));

vi.mock('../context.js', () => ({
  getContext: vi.fn(async () => ({
    projectRoot: '/fake/project',
    config: { totemDir: '.totem', lanceDir: '.totem/.lance' },
  })),
  getProjectBasics: vi.fn(async () => ({
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
    mockResolution = RESOLVED_HIT;
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

  // --- The resolved CLI (mmnto-ai/totem#3008) ---

  it('spawns node with the resolved entry, never a package manager, npx, a bare totem or a shell', async () => {
    // A lockfile no longer picks the command: pnpm-lock.yaml present changes nothing.
    existingLockFiles = new Set(['pnpm-lock.yaml']);
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: true });

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([FAKE_ENTRY, 'lint', '--staged']);
    for (const arg of args as string[]) {
      expect(['npx', 'pnpm', 'yarn', 'totem']).not.toContain(arg);
    }
    expect((opts as { shell?: unknown }).shell).toBeFalsy();
  });

  it('does not include --staged flag when staged_only is false', async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: false });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(process.execPath);
    expect(lastCall[1]).toEqual([FAKE_ENTRY, 'lint']);
  });

  it('names the CLI that ran on the first line of the result', async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'All checks passed.';

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0]!.text.split('\n')[0]).toBe('CLI: @mmnto/cli@9.9.9, pinned');
  });

  it('with nothing resolvable, spawns nothing and says NOT RUN with the three places looked', async () => {
    mockResolution = {
      ok: false,
      looked: LOOKED,
      unverified: ['/usr/local/bin/totem'],
    };

    const { spawn } = await import('node:child_process');

    const result = (await handle({ staged_only: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text.startsWith('Verification: NOT RUN\n\nTotem CLI not found.')).toBe(true);
    for (const place of LOOKED) expect(text).toContain(place);
    expect(text).toContain(
      'A totem executable was found on PATH at /usr/local/bin/totem but could not be verified as an npm-layout install of @mmnto/cli, so it was not run.',
    );
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
    // The full text includes the "CLI: ..." line and the "Verification: PASS\n\n"
    // prefix plus the captured output
    const capturedPart = outputText
      .replace('CLI: @mmnto/cli@9.9.9, pinned\n', '')
      .replace('Verification: PASS\n\n', '');
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

  it('runs lint when the vector store cannot be opened (mmnto-ai/totem#3009)', async () => {
    // A primary-store fault makes getContext() reject; verify_execution needs
    // only the project root and must not route through the store at all.
    // (The real class is not imported: this file mocks node:child_process and
    // node:fs for the tool alone, and the core barrel is kept out of it. The
    // real rejection and getProjectBasics() over a corrupted primary store are
    // exercised in context-linked-rebuild.test.ts.)
    const contextMock = await import('../context.js');
    vi.mocked(contextMock.getContext).mockRejectedValue(
      Object.assign(new Error('[Totem Error] The vector store cannot be opened.'), {
        name: 'StoreNeedsRebuildError',
        code: 'STORE_NEEDS_REBUILD',
      }),
    );
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'All checks passed.';

    try {
      const result = (await handle({ staged_only: true })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBe(false);
      expect(result.content[0]!.text).toContain('Verification: PASS');
      expect(vi.mocked(contextMock.getContext)).not.toHaveBeenCalled();
    } finally {
      vi.mocked(contextMock.getContext).mockReset();
    }
  });

  it('handles context initialization failure', async () => {
    // Override the project-root loader to throw for this test
    const contextMock = await import('../context.js');
    vi.mocked(contextMock.getProjectBasics).mockRejectedValueOnce(new Error('Config missing'));

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

  // --- Spawn options (#1023; no shell since mmnto-ai/totem#3008) ---

  it('passes env to spawn and no shell (node runs the entry directly)', async () => {
    mockSpawnExitCode = 0;
    mockSpawnStdout = 'ok';

    const { spawn } = await import('node:child_process');

    await handle({ staged_only: true });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    const opts = lastCall[2] as Record<string, unknown>;
    const env = opts.env as Record<string, unknown>;
    expect(env).toBeDefined();
    expect(Object.keys(env).some((k) => k.toLowerCase() === 'path')).toBe(true);
    expect(opts.shell).toBeFalsy();
  });
});
