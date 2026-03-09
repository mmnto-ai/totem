import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeShellOrchestrator } from './utils.js';

// ─── Mock spawn ──────────────────────────────────────

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

let mockChild: MockChild;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

const { spawn } = await import('node:child_process');
const mockedSpawn = vi.mocked(spawn);

// ─── Tests ───────────────────────────────────────────

describe('invokeShellOrchestrator', () => {
  let tmpDir: string;
  const totemDir = '.totem';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orch-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChild = createMockChild();
    mockedSpawn.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Emit stdout data and close with success */
  function emitSuccess(data: string) {
    process.nextTick(() => {
      mockChild.stdout.emit('data', Buffer.from(data));
      mockChild.emit('close', 0);
    });
  }

  /** Emit close with non-zero exit code and optional stderr */
  function emitFailure(code: number, stderr = '') {
    process.nextTick(() => {
      if (stderr) mockChild.stderr.emit('data', Buffer.from(stderr));
      mockChild.emit('close', code);
    });
  }

  it('returns raw content when output is not Gemini JSON', async () => {
    emitSuccess('  The answer is 42.  ');
    const result = await invokeShellOrchestrator(
      'prompt text',
      'echo {file}',
      'test-model',
      tmpDir,
      'Test',
      totemDir,
    );
    expect(result.content).toBe('The answer is 42.');
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('parses Gemini JSON output and returns structured result', async () => {
    const geminiOutput = JSON.stringify({
      response: 'Gemini says hello.',
      stats: {
        models: {
          'gemini-2.5-pro': {
            tokens: { input: 100, candidates: 50 },
            api: { totalLatencyMs: 2000 },
          },
        },
      },
    });
    emitSuccess(geminiOutput);
    const result = await invokeShellOrchestrator(
      'prompt',
      'gemini -e none < {file}',
      'gemini-2.5-pro',
      tmpDir,
      'Test',
      totemDir,
    );
    expect(result.content).toBe('Gemini says hello.');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.durationMs).toBe(2000);
  });

  it('substitutes {file} and {model} in command', async () => {
    emitSuccess('ok');
    await invokeShellOrchestrator(
      'prompt',
      'llm --model {model} < {file}',
      'my-model',
      tmpDir,
      'Test',
      totemDir,
    );
    const cmd = mockedSpawn.mock.calls[0]![0] as string;
    expect(cmd).toContain('my-model');
    expect(cmd).not.toContain('{model}');
    expect(cmd).not.toContain('{file}');
  });

  it('writes prompt to temp file and cleans up after', async () => {
    emitSuccess('result');
    await invokeShellOrchestrator(
      'my prompt content',
      'cat {file}',
      'model',
      tmpDir,
      'Test',
      totemDir,
    );
    // Temp file should be cleaned up
    const tempDir = path.join(tmpDir, totemDir, 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir).filter((f) => f.startsWith('totem-test-'));
      expect(files).toHaveLength(0);
    }
  });

  it('throws QuotaError for quota-related failures', async () => {
    emitFailure(1, '429 Too Many Requests quota exceeded');
    try {
      await invokeShellOrchestrator('prompt', 'cmd', 'model', tmpDir, 'Test', totemDir);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('throws generic error for non-zero exit code', async () => {
    emitFailure(1, 'something went wrong');
    await expect(
      invokeShellOrchestrator('prompt', 'cmd', 'model', tmpDir, 'Test', totemDir),
    ).rejects.toThrow('[Totem Error] Shell orchestrator command failed');
  });

  it('throws error on spawn error event', async () => {
    process.nextTick(() => {
      mockChild.emit('error', new Error('command not found'));
    });
    await expect(
      invokeShellOrchestrator('prompt', 'cmd', 'model', tmpDir, 'Test', totemDir),
    ).rejects.toThrow('command not found');
  });

  it('throws descriptive error for timeout', async () => {
    vi.useFakeTimers();

    // Simulate kill → close (rejection now happens in the close handler)
    mockChild.kill = vi.fn(() => {
      process.nextTick(() => mockChild.emit('close', null));
    });

    // Capture the rejection before advancing timers
    const promise = invokeShellOrchestrator(
      'prompt',
      'cmd',
      'model',
      tmpDir,
      'Test',
      totemDir,
    ).catch((err: Error) => err);

    await vi.advanceTimersByTimeAsync(180_001);

    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('timed out after 180s');
    expect(mockChild.kill).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
