import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrchestratorResult } from './orchestrator.js';

// ─── Mock SDKs ──────────────────────────────────────

const { mockGenerateContent, mockCreate } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}));

// ─── Mock child_process for shell provider ──────────

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

// ─── Import orchestrators ───────────────────────────

import { invokeAnthropicOrchestrator } from './anthropic-orchestrator.js';
import { invokeGeminiOrchestrator } from './gemini-orchestrator.js';
import { invokeShellOrchestrator } from './shell-orchestrator.js';

// ─── Shared test opts ───────────────────────────────

const baseOpts = {
  prompt: 'conformance test prompt',
  model: 'test-model',
  cwd: '.',
  tag: 'Conformance',
  totemDir: '.totem',
};

// ─── Conformance contract assertions ────────────────

function assertOrchestratorResult(result: OrchestratorResult): void {
  expect(typeof result.content).toBe('string');
  expect(typeof result.durationMs).toBe('number');
  expect(result.durationMs).toBeGreaterThanOrEqual(0);

  // Token counts are number | null
  if (result.inputTokens !== null) {
    expect(typeof result.inputTokens).toBe('number');
  }
  if (result.outputTokens !== null) {
    expect(typeof result.outputTokens).toBe('number');
  }
}

// ─── SDK Provider Conformance (Gemini + Anthropic) ──

interface SdkFixture {
  name: string;
  envKey: string;
  setupHappy: () => void;
  setupQuota: () => void;
  setupGenericError: () => void;
  invoke: () => Promise<OrchestratorResult>;
}

const sdkFixtures: SdkFixture[] = [
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    setupHappy: () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'conformance-ok',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: 'STOP' }],
      });
    },
    setupQuota: () => {
      mockGenerateContent.mockRejectedValueOnce(
        Object.assign(new Error('quota exceeded'), { status: 429 }),
      );
    },
    setupGenericError: () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Model not found'));
    },
    invoke: () => invokeGeminiOrchestrator(baseOpts),
  },
  {
    name: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    setupHappy: () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'conformance-ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });
    },
    setupQuota: () => {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }));
    },
    setupGenericError: () => {
      mockCreate.mockRejectedValueOnce(new Error('invalid_api_key'));
    },
    invoke: () => invokeAnthropicOrchestrator(baseOpts),
  },
];

describe.each(sdkFixtures)('$name provider conformance', (fixture) => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env[fixture.envKey] = 'test-key';
  });

  afterEach(() => {
    delete process.env[fixture.envKey];
  });

  it('returns a valid OrchestratorResult on happy path', async () => {
    fixture.setupHappy();
    const result = await fixture.invoke();

    assertOrchestratorResult(result);
    expect(result.content).toBe('conformance-ok');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });

  it('throws descriptive error when API key is missing', async () => {
    delete process.env[fixture.envKey];
    await expect(fixture.invoke()).rejects.toThrow(/No .+ API key found/);
  });

  it('converts quota/429 errors to QuotaError', async () => {
    fixture.setupQuota();
    await expect(fixture.invoke()).rejects.toHaveProperty('name', 'QuotaError');
  });

  it('wraps generic API errors with [Totem Error] prefix', async () => {
    fixture.setupGenericError();
    await expect(fixture.invoke()).rejects.toThrow('[Totem Error]');
  });

  it('includes durationMs >= 0 in result', async () => {
    fixture.setupHappy();
    const result = await fixture.invoke();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Shell Provider Conformance ─────────────────────

describe('shell provider conformance', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-conf-'));
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChild = createMockChild();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const shellOpts = () => ({
    prompt: 'conformance test prompt',
    command: 'echo {file}',
    model: 'test-model',
    cwd: tmpDir,
    tag: 'Conformance',
    totemDir: '.totem',
  });

  function emitSuccess(data: string) {
    process.nextTick(() => {
      mockChild.stdout.emit('data', Buffer.from(data));
      mockChild.emit('close', 0);
    });
  }

  function emitFailure(code: number, stderr = '') {
    process.nextTick(() => {
      if (stderr) mockChild.stderr.emit('data', Buffer.from(stderr));
      mockChild.emit('close', code);
    });
  }

  it('returns a valid OrchestratorResult on happy path', async () => {
    emitSuccess('conformance-ok');
    const result = await invokeShellOrchestrator(shellOpts());

    assertOrchestratorResult(result);
    expect(result.content).toBe('conformance-ok');
    // Shell orchestrator returns null tokens for non-Gemini output
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it('returns structured tokens when output is Gemini JSON', async () => {
    const geminiOutput = JSON.stringify({
      response: 'conformance-ok',
      stats: {
        models: {
          'test-model': {
            tokens: { input: 10, candidates: 5 },
            api: { totalLatencyMs: 1000 },
          },
        },
      },
    });
    emitSuccess(geminiOutput);
    const result = await invokeShellOrchestrator(shellOpts());

    assertOrchestratorResult(result);
    expect(result.content).toBe('conformance-ok');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });

  it('converts quota errors to QuotaError', async () => {
    emitFailure(1, '429 Too Many Requests quota exceeded');
    await expect(invokeShellOrchestrator(shellOpts())).rejects.toHaveProperty('name', 'QuotaError');
  });

  it('wraps generic errors with [Totem Error] prefix', async () => {
    emitFailure(1, 'something went wrong');
    await expect(invokeShellOrchestrator(shellOpts())).rejects.toThrow('[Totem Error]');
  });

  it('includes durationMs >= 0 in result', async () => {
    emitSuccess('ok');
    const result = await invokeShellOrchestrator(shellOpts());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
