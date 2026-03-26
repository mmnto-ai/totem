import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeShellOrchestrator, tryParseGeminiJson } from './shell-orchestrator.js';

// ─── Mock spawn ──────────────────────────────────────

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 12345;
  return child;
}

let mockChild: MockChild;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
  execFile: vi.fn(),
}));

const { spawn } = await import('node:child_process');
const mockedSpawn = vi.mocked(spawn);

// ─── invokeShellOrchestrator ─────────────────────────

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
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
    const result = await invokeShellOrchestrator({
      prompt: 'prompt text',
      command: 'echo {file}',
      model: 'test-model',
      cwd: tmpDir,
      tag: 'Test',
      totemDir,
    });
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
    const result = await invokeShellOrchestrator({
      prompt: 'prompt',
      command: 'gemini -e none < {file}',
      model: 'gemini-2.5-pro',
      cwd: tmpDir,
      tag: 'Test',
      totemDir,
    });
    expect(result.content).toBe('Gemini says hello.');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.durationMs).toBe(2000);
  });

  it('substitutes {file} and {model} in command', async () => {
    emitSuccess('ok');
    await invokeShellOrchestrator({
      prompt: 'prompt',
      command: 'llm --model {model} < {file}',
      model: 'my-model',
      cwd: tmpDir,
      tag: 'Test',
      totemDir,
    });
    const cmd = mockedSpawn.mock.calls[0]![0] as string;
    expect(cmd).toContain('my-model');
    expect(cmd).not.toContain('{model}');
    expect(cmd).not.toContain('{file}');
  });

  it('writes prompt to temp file and cleans up after', async () => {
    emitSuccess('result');
    await invokeShellOrchestrator({
      prompt: 'my prompt content',
      command: 'cat {file}',
      model: 'model',
      cwd: tmpDir,
      tag: 'Test',
      totemDir,
    });
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
      await invokeShellOrchestrator({
        prompt: 'prompt',
        command: 'cmd',
        model: 'model',
        cwd: tmpDir,
        tag: 'Test',
        totemDir,
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('throws generic error for non-zero exit code', async () => {
    emitFailure(1, 'something went wrong');
    await expect(
      invokeShellOrchestrator({
        prompt: 'prompt',
        command: 'cmd',
        model: 'model',
        cwd: tmpDir,
        tag: 'Test',
        totemDir,
      }),
    ).rejects.toThrow('[Totem Error] Shell orchestrator command failed');
  });

  it('throws error on spawn error event', async () => {
    process.nextTick(() => {
      mockChild.emit('error', new Error('command not found'));
    });
    await expect(
      invokeShellOrchestrator({
        prompt: 'prompt',
        command: 'cmd',
        model: 'model',
        cwd: tmpDir,
        tag: 'Test',
        totemDir,
      }),
    ).rejects.toThrow('command not found');
  });

  it('throws descriptive error for timeout', async () => {
    vi.useFakeTimers();

    // On timeout, killTree fires (taskkill on Windows, process.kill on Unix).
    // Either way, simulate the child closing after kill.
    const originalKill = process.kill;
    process.kill = vi.fn(() => {
      process.nextTick(() => mockChild.emit('close', null));
    }) as unknown as typeof process.kill;
    // Also handle Windows path: taskkill triggers a new spawn call
    vi.mocked(spawn).mockImplementation(((cmd: string) => {
      if (cmd === 'taskkill') {
        process.nextTick(() => mockChild.emit('close', null));
        return mockChild;
      }
      return mockChild;
    }) as unknown as typeof spawn);

    // Capture the rejection before advancing timers
    const promise = invokeShellOrchestrator({
      prompt: 'prompt',
      command: 'cmd',
      model: 'model',
      cwd: tmpDir,
      tag: 'Test',
      totemDir,
    }).catch((err: Error) => err);

    await vi.advanceTimersByTimeAsync(180_001);

    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('timed out after 180s');

    // Verify kill was actually attempted (Windows: taskkill spawn, Unix: process.kill)
    const killAttempted =
      vi.mocked(process.kill).mock.calls.length > 0 ||
      vi.mocked(spawn).mock.calls.some(([cmd]) => cmd === 'taskkill');
    expect(killAttempted).toBe(true);

    process.kill = originalKill;
    vi.useRealTimers();
  });
});

// ─── tryParseGeminiJson ──────────────────────────────

describe('tryParseGeminiJson', () => {
  it('returns null for non-JSON input', () => {
    expect(tryParseGeminiJson('plain text output')).toBeNull();
  });

  it('returns null for JSON that does not match Gemini schema', () => {
    expect(tryParseGeminiJson('{"foo": "bar"}')).toBeNull();
  });

  it('returns null when stats.models is empty', () => {
    const input = JSON.stringify({
      response: 'hello',
      stats: { models: {} },
    });
    expect(tryParseGeminiJson(input)).toBeNull();
  });

  it('parses valid Gemini output with token stats', () => {
    const input = JSON.stringify({
      response: 'The answer is 42.',
      stats: {
        models: {
          'gemini-2.5-pro': {
            tokens: { input: 500, candidates: 200 },
            api: { totalLatencyMs: 3000 },
          },
        },
      },
    });
    const result = tryParseGeminiJson(input);
    expect(result).toEqual({
      content: 'The answer is 42.',
      inputTokens: 500,
      outputTokens: 200,
      latencyMs: 3000,
    });
  });

  it('aggregates stats across multiple models', () => {
    const input = JSON.stringify({
      response: 'multi-model',
      stats: {
        models: {
          'model-a': { tokens: { input: 100, candidates: 50 }, api: { totalLatencyMs: 1000 } },
          'model-b': { tokens: { input: 200, candidates: 75 }, api: { totalLatencyMs: 2000 } },
        },
      },
    });
    const result = tryParseGeminiJson(input);
    expect(result).toEqual({
      content: 'multi-model',
      inputTokens: 300,
      outputTokens: 125,
      latencyMs: 3000,
    });
  });

  it('returns latencyMs null when api stats are missing', () => {
    const input = JSON.stringify({
      response: 'no api stats',
      stats: {
        models: {
          'gemini-flash': { tokens: { input: 10, candidates: 5 } },
        },
      },
    });
    const result = tryParseGeminiJson(input);
    expect(result).not.toBeNull();
    expect(result!.latencyMs).toBeNull();
  });

  it('defaults missing token counts to zero', () => {
    const input = JSON.stringify({
      response: 'no tokens key',
      stats: {
        models: {
          'gemini-flash': { api: { totalLatencyMs: 500 } },
        },
      },
    });
    const result = tryParseGeminiJson(input);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(0);
    expect(result!.outputTokens).toBe(0);
  });
});
