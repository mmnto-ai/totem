import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock utils to bypass real config loading ───────────

const MOCK_CONFIG = {
  targets: [{ glob: '**/*.ts' }, { glob: '**/*.js' }],
  totemDir: '.totem',
  ignorePatterns: ['node_modules'],
  orchestrator: {
    defaultModel: 'gemini-3-flash-preview',
    temperature: 0,
  },
  strictGovernance: true,
};

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: () => '/fake/totem.config.ts',
    loadConfig: async () => MOCK_CONFIG,
  };
});

// ─── Helpers ────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, ''); // totem-context: ANSI regex — not user input
}

// ─── Tests ──────────────────────────────────────────────

describe('getNestedValue', () => {
  let getNestedValue: (typeof import('./config.js'))['getNestedValue'];

  beforeEach(async () => {
    ({ getNestedValue } = await import('./config.js'));
  });

  it('resolves simple top-level key', () => {
    expect(getNestedValue({ foo: 'bar' }, 'foo')).toBe('bar');
  });

  it('resolves nested dot-path', () => {
    const obj = { orchestrator: { defaultModel: 'gpt-4' } };
    expect(getNestedValue(obj, 'orchestrator.defaultModel')).toBe('gpt-4');
  });

  it('resolves array index', () => {
    const obj = { targets: [{ glob: '**/*.ts' }, { glob: '**/*.js' }] };
    expect(getNestedValue(obj, 'targets.0.glob')).toBe('**/*.ts');
  });

  it('returns undefined for missing intermediate key', () => {
    expect(getNestedValue({ foo: 'bar' }, 'baz.qux')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(getNestedValue({ foo: 'bar' }, '')).toBeUndefined();
  });

  it('returns full object when key points to an object', () => {
    const obj = { orchestrator: { defaultModel: 'gpt-4', temperature: 0 } };
    expect(getNestedValue(obj, 'orchestrator')).toEqual({
      defaultModel: 'gpt-4',
      temperature: 0,
    });
  });
});

describe('configGetCommand', () => {
  let savedExitCode: number | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
  });

  it('prints primitive value to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configGetCommand } = await import('./config.js');
    await configGetCommand('totemDir');

    expect(logSpy).toHaveBeenCalledWith('.totem');
  });

  it('prints boolean value to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configGetCommand } = await import('./config.js');
    await configGetCommand('strictGovernance');

    expect(logSpy).toHaveBeenCalledWith('true');
  });

  it('prints nested primitive value to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configGetCommand } = await import('./config.js');
    await configGetCommand('orchestrator.defaultModel');

    expect(logSpy).toHaveBeenCalledWith('gemini-3-flash-preview');
  });

  it('prints object value as JSON', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configGetCommand } = await import('./config.js');
    await configGetCommand('orchestrator');

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      defaultModel: 'gemini-3-flash-preview',
      temperature: 0,
    });
  });

  it('prints array value as JSON', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configGetCommand } = await import('./config.js');
    await configGetCommand('targets');

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([{ glob: '**/*.ts' }, { glob: '**/*.js' }]);
  });

  it('sets exitCode 1 for missing key', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configGetCommand } = await import('./config.js');
    await configGetCommand('nonexistent.key');

    expect(process.exitCode).toBe(1);
    const output = stripAnsi(errorSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain("No configuration value found for key 'nonexistent.key'");
  });
});

describe('configSetCommand', () => {
  let savedExitCode: number | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
  });

  it('sets exitCode 1', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configSetCommand } = await import('./config.js');
    await configSetCommand('foo', 'bar');

    expect(process.exitCode).toBe(1);
  });

  it('logs not-implemented message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { configSetCommand } = await import('./config.js');
    await configSetCommand('foo', 'bar');

    const output = stripAnsi(errorSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('not yet implemented');
    expect(output).toContain('totem.config.ts');
  });
});
