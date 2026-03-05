import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeShellOrchestrator } from './utils.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

const { execSync } = await import('node:child_process');
const mockedExec = vi.mocked(execSync);

describe('invokeShellOrchestrator', () => {
  let tmpDir: string;
  const totemDir = '.totem';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orch-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedExec.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns raw content when output is not Gemini JSON', () => {
    mockedExec.mockReturnValue('  The answer is 42.  ');
    const result = invokeShellOrchestrator(
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

  it('parses Gemini JSON output and returns structured result', () => {
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
    mockedExec.mockReturnValue(geminiOutput);
    const result = invokeShellOrchestrator(
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

  it('substitutes {file} and {model} in command', () => {
    mockedExec.mockReturnValue('ok');
    invokeShellOrchestrator(
      'prompt',
      'llm --model {model} < {file}',
      'my-model',
      tmpDir,
      'Test',
      totemDir,
    );
    const cmd = mockedExec.mock.calls[0]![0] as string;
    expect(cmd).toContain('my-model');
    expect(cmd).not.toContain('{model}');
    expect(cmd).not.toContain('{file}');
  });

  it('writes prompt to temp file and cleans up after', () => {
    mockedExec.mockReturnValue('result');
    invokeShellOrchestrator('my prompt content', 'cat {file}', 'model', tmpDir, 'Test', totemDir);
    // Temp file should be cleaned up
    const tempDir = path.join(tmpDir, totemDir, 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir).filter((f) => f.startsWith('totem-test-'));
      expect(files).toHaveLength(0);
    }
  });

  it('throws QuotaError for quota-related failures', () => {
    mockedExec.mockImplementation(() => {
      const err = new Error('429 Too Many Requests') as Error & { stderr?: Buffer };
      err.stderr = Buffer.from('quota exceeded');
      throw err;
    });
    expect(() =>
      invokeShellOrchestrator('prompt', 'cmd', 'model', tmpDir, 'Test', totemDir),
    ).toThrow();
    try {
      invokeShellOrchestrator('prompt', 'cmd', 'model', tmpDir, 'Test', totemDir);
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('throws generic error for non-quota failures', () => {
    mockedExec.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(() =>
      invokeShellOrchestrator('prompt', 'cmd', 'model', tmpDir, 'Test', totemDir),
    ).toThrow('[Totem Error] Shell orchestrator command failed');
  });
});
