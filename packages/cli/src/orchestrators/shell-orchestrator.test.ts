import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
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
  let originalProcessKill: typeof process.kill;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orch-'));
    originalProcessKill = process.kill;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChild = createMockChild();
    mockedSpawn.mockClear();
  });

  afterEach(() => {
    process.kill = originalProcessKill;
    vi.useRealTimers();
    cleanTmpDir(tmpDir);
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

  // ─── Model sanitization (shell-injection defense) ──
  //
  // Regression tests for the RCE found during the pre-1.15.0 deep review:
  // the `{model}` token was interpolated raw into a string executed with
  // `shell: true`, so a poisoned config value could run arbitrary shell
  // commands. Fix is two layers: (1) allow-list MODEL_SAFE_RE rejects
  // metacharacters at the boundary, (2) defense-in-depth shell-quoting of
  // the token at interpolation.

  describe('model sanitization', () => {
    const EXPLOITS = [
      ['semicolon', 'gemini; echo pwned'],
      ['backtick', 'gemini`echo pwned`'],
      ['dollar-subshell', 'gemini$(echo pwned)'],
      ['pipe', 'gemini | echo pwned'],
      ['redirect', 'gemini > /tmp/pwned'],
      ['newline', 'gemini\necho pwned'],
      ['ampersand', 'gemini && echo pwned'],
      ['space', 'gemini pwned'],
      ['quote', "gemini'"],
      ['dquote', 'gemini"'],
      ['paren', 'gemini()'],
      ['leading-dash', '-rf'],
    ] as const;

    for (const [label, badModel] of EXPLOITS) {
      it(`rejects model with ${label} and never spawns`, async () => {
        await expect(
          invokeShellOrchestrator({
            prompt: 'prompt',
            command: 'llm --model {model} < {file}',
            model: badModel,
            cwd: tmpDir,
            tag: 'Test',
            totemDir,
          }),
        ).rejects.toThrow(/refuses model/);
        // Critical invariant: spawn MUST NOT have been called. The allow-list
        // fires before we ever reach shell execution.
        expect(mockedSpawn).not.toHaveBeenCalled();
      });
    }

    const BENIGN = [
      ['simple', 'gemini-2.5-pro'],
      ['provider-qualified', 'anthropic:claude-sonnet-4-6'],
      ['namespaced-slash', 'ollama/gemma4'],
      ['dotted', 'claude.sonnet.4.6'],
      ['ollama-tag', 'gemma4:e4b'],
      ['alphanumeric-only', 'gpt5'],
      ['ollama-quantized', 'llama2:13b-chat-q4_0'],
      ['underscore', 'my_model_v2'],
    ] as const;

    for (const [label, goodModel] of BENIGN) {
      it(`accepts benign model (${label})`, async () => {
        emitSuccess('ok');
        await invokeShellOrchestrator({
          prompt: 'prompt',
          command: 'llm --model {model} < {file}',
          model: goodModel,
          cwd: tmpDir,
          tag: 'Test',
          totemDir,
        });
        expect(mockedSpawn).toHaveBeenCalledOnce();
      });
    }

    it('shell-quotes the model token even after allow-list passes (defense in depth)', async () => {
      emitSuccess('ok');
      await invokeShellOrchestrator({
        prompt: 'prompt',
        command: 'llm --model {model} < {file}',
        model: 'gemini-2.5-pro',
        cwd: tmpDir,
        tag: 'Test',
        totemDir,
      });
      const cmd = mockedSpawn.mock.calls[0]![0] as string;
      // Expect the model to appear inside quotes (either ' on Unix or " on
      // Windows). This prevents a future regression that removes the
      // allow-list but leaves interpolation unquoted from re-opening the
      // RCE hole.
      const quoted = cmd.includes("'gemini-2.5-pro'") || cmd.includes('"gemini-2.5-pro"');
      expect(quoted).toBe(true);
    });
  });

  // ─── systemPrompt threading (mmnto/totem#1291 Phase 3 cascade fix) ──

  describe('systemPrompt threading', { timeout: 15000 }, () => {
    /**
     * Read the orchestrator's tempfile during the nextTick callback that
     * emits the close event. The shell orchestrator deletes the tempfile in
     * its `finally` block, which runs only after the awaited promise
     * resolves — so reading during nextTick (before close emission) catches
     * the bytes the orchestrator wrote.
     *
     * vi.spyOn(fs, 'writeFileSync') doesn't work here because fs is a star
     * import (non-configurable property), so we go to disk instead.
     */
    function emitSuccessAndCapture(): { promise: Promise<string> } {
      let resolveCaptured: (s: string) => void;
      const promise = new Promise<string>((resolve) => {
        resolveCaptured = resolve;
      });
      process.nextTick(() => {
        const tempDir = path.join(tmpDir, totemDir, 'temp');
        try {
          const files = fs.readdirSync(tempDir).filter((f) => f.startsWith('totem-test-'));
          if (files.length > 0) {
            const content = fs.readFileSync(path.join(tempDir, files[0]!), 'utf-8');
            resolveCaptured(content);
          } else {
            resolveCaptured('<no tempfile found>');
          }
        } catch (err) {
          resolveCaptured(`<read error: ${(err as Error).message}>`);
        }
        mockChild.stdout.emit('data', Buffer.from('ok'));
        mockChild.emit('close', 0);
      });
      return { promise };
    }

    it('concatenates systemPrompt and prompt into the tempfile when systemPrompt is provided', async () => {
      const { promise: capturedPromise } = emitSuccessAndCapture();
      await invokeShellOrchestrator({
        prompt: 'lesson body',
        systemPrompt: 'COMPILER_SYSTEM_PROMPT',
        command: 'echo {file}',
        model: 'test-model',
        cwd: tmpDir,
        tag: 'Test',
        totemDir,
      });

      const captured = await capturedPromise;
      // Shell orchestrators talk to CLI binaries with no system/user message
      // API. Concatenation is the only correct fallback. Order is system
      // first (the persistent context the LLM should follow), blank line,
      // then user prompt.
      expect(captured).toBe('COMPILER_SYSTEM_PROMPT\n\nlesson body');
    });

    it('writes only the user prompt when systemPrompt is undefined (backward compat)', async () => {
      const { promise: capturedPromise } = emitSuccessAndCapture();
      await invokeShellOrchestrator({
        prompt: 'just the prompt',
        command: 'echo {file}',
        model: 'test-model',
        cwd: tmpDir,
        tag: 'Test',
        totemDir,
      });

      const captured = await capturedPromise;
      expect(captured).toBe('just the prompt');
    });
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
