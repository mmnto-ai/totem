import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the CLI-probe seam (cliExists → safeExec) so branch selection is
// host-independent: no real `where`/`which` spawns, no PATH sensitivity.
vi.mock('@mmnto/totem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mmnto/totem')>();
  return {
    ...actual,
    safeExec: vi.fn(() => {
      throw new Error('not on PATH');
    }),
  };
});

import { safeExec } from '@mmnto/totem';

import {
  buildRoleOverrides,
  detectOrchestrator,
  INIT_ORCHESTRATOR_MODELS,
  INIT_ORCHESTRATOR_ROLES,
  renderOrchestratorBlock,
} from './init-detect.js';

const API_KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

// Independent contract fixtures (mmnto-ai/totem#2360 review round): pinned as
// literals so an accidental edit to the production constants fails here
// instead of flowing through derived expectations and staying green.
const EXPECTED_ROLES = [
  'compile',
  'docs',
  'spec',
  'shield',
  'triage',
  'extract',
  'reviewlearn',
] as const;
const EXPECTED_MODELS = {
  geminiCli: 'gemini-3.5-flash',
  claudeCli: 'sonnet',
  gemini: 'gemini-3.5-flash',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-terra',
  ollama: 'gemma4',
} as const;

/** Make cliExists() succeed only for the given binary names. */
function stubCliOnPath(...names: string[]): void {
  vi.mocked(safeExec).mockImplementation(((_cmd: string, args?: string[]) => {
    if (args && names.includes(args[0]!)) return '';
    throw new Error('not on PATH');
  }) as typeof safeExec);
}

describe('detectOrchestrator emission shape (Tenet-16 corollary)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-initdetect-'));
    // Neutralize host API keys so only per-test .env content drives detection.
    for (const v of API_KEY_VARS) vi.stubEnv(v, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(safeExec).mockImplementation(() => {
      throw new Error('not on PATH');
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEnv(content: string): void {
    fs.writeFileSync(path.join(tmpDir, '.env'), content);
  }

  it('returns null when no CLI or API key is present', () => {
    expect(detectOrchestrator(tmpDir)).toBeNull();
  });

  it('production constants match the pinned contract fixtures', () => {
    expect([...INIT_ORCHESTRATOR_ROLES]).toEqual([...EXPECTED_ROLES]);
    expect(INIT_ORCHESTRATOR_MODELS).toEqual(EXPECTED_MODELS);
  });

  it.each([
    ['GEMINI_API_KEY', 'gemini', EXPECTED_MODELS.gemini],
    ['GOOGLE_API_KEY', 'gemini', EXPECTED_MODELS.gemini],
    ['ANTHROPIC_API_KEY', 'anthropic', EXPECTED_MODELS.anthropic],
    ['OPENAI_API_KEY', 'openai', EXPECTED_MODELS.openai],
  ])('%s → provider %s with every role on %s', (envKey, provider, model) => {
    writeEnv(`${envKey}=test-key\n`);
    const result = detectOrchestrator(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.config['provider']).toBe(provider);
    expect(result!.config['overrides']).toEqual(
      Object.fromEntries(EXPECTED_ROLES.map((role) => [role, model])),
    );
  });

  it('gemini CLI on PATH wins over API keys and emits the shell provider', () => {
    stubCliOnPath('gemini');
    writeEnv('ANTHROPIC_API_KEY=test-key\n');
    const result = detectOrchestrator(tmpDir);
    expect(result!.config['provider']).toBe('shell');
    expect(result!.config['command']).toContain('gemini --model {model}');
    expect(result!.config['overrides']).toEqual(
      Object.fromEntries(EXPECTED_ROLES.map((role) => [role, EXPECTED_MODELS.geminiCli])),
    );
  });

  it('claude CLI branch emits the tier alias, not a dated pin', () => {
    stubCliOnPath('claude');
    const result = detectOrchestrator(tmpDir);
    expect(result!.config['provider']).toBe('shell');
    expect(result!.config['command']).toBe('claude -p --model {model} < {file}');
    expect(result!.config['command']).not.toContain('-p {file}');
    expect(result!.config['overrides']).toEqual(
      Object.fromEntries(EXPECTED_ROLES.map((role) => [role, 'sonnet'])),
    );
  });

  it('ollama branch emits gemma4 per-role', () => {
    stubCliOnPath('ollama');
    const result = detectOrchestrator(tmpDir);
    expect(result!.config['provider']).toBe('ollama');
    expect(result!.config['overrides']).toEqual(
      Object.fromEntries(EXPECTED_ROLES.map((role) => [role, 'gemma4'])),
    );
  });

  it('no branch emits an ambient defaultModel, in the config object or the rendered block', () => {
    const branches: Array<() => void> = [
      () => stubCliOnPath('gemini'),
      () => stubCliOnPath('claude'),
      () => stubCliOnPath('ollama'),
      () => writeEnv('GEMINI_API_KEY=test-key\n'),
      () => writeEnv('ANTHROPIC_API_KEY=test-key\n'),
      () => writeEnv('OPENAI_API_KEY=test-key\n'),
    ];
    for (const arm of branches) {
      vi.mocked(safeExec).mockImplementation(() => {
        throw new Error('not on PATH');
      });
      fs.rmSync(path.join(tmpDir, '.env'), { force: true });
      arm();
      const result = detectOrchestrator(tmpDir);
      expect(result).not.toBeNull();
      expect(Object.keys(result!.config)).not.toContain('defaultModel');
      expect(result!.block).not.toContain('defaultModel');
      expect(Object.keys(result!.config['overrides'] as Record<string, string>).sort()).toEqual(
        [...EXPECTED_ROLES].sort(),
      );
    }
  });
});

describe('buildRoleOverrides', () => {
  it('maps every emitted role to the given model', () => {
    const overrides = buildRoleOverrides('some-model');
    expect(Object.keys(overrides)).toEqual([...EXPECTED_ROLES]);
    expect(new Set(Object.values(overrides))).toEqual(new Set(['some-model']));
  });
});

describe('renderOrchestratorBlock', () => {
  it('renders the TS block from the same object serialized to YAML/TOML (no drift)', () => {
    const config = {
      provider: 'gemini',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.gemini),
    };
    const block = renderOrchestratorBlock(config);
    expect(block.startsWith('  orchestrator: {')).toBe(true);
    expect(block.endsWith('  },')).toBe(true);
    expect(block).toContain("    provider: 'gemini',");
    for (const role of INIT_ORCHESTRATOR_ROLES) {
      expect(block).toContain(`      ${role}: '${INIT_ORCHESTRATOR_MODELS.gemini}',`);
    }
  });

  it('escapes single quotes and backslashes in string values (no silent syntax break)', () => {
    const block = renderOrchestratorBlock({
      provider: 'shell',
      command: "echo 'it''s' \\ done",
      overrides: { compile: "model'with\\quirks" },
    });
    expect(block).toContain("    command: 'echo \\'it\\'\\'s\\' \\\\ done',");
    expect(block).toContain("      compile: 'model\\'with\\\\quirks',");
  });

  it('renders booleans, numbers, and arrays instead of silently omitting them', () => {
    const block = renderOrchestratorBlock({
      provider: 'gemini',
      enableContextCaching: true,
      maxRetries: 3,
      lanes: ['anthropic:claude-sonnet-5', 'gemini:gemini-3.5-flash'],
    });
    expect(block).toContain('    enableContextCaching: true,');
    expect(block).toContain('    maxRetries: 3,');
    expect(block).toContain('    lanes: ["anthropic:claude-sonnet-5","gemini:gemini-3.5-flash"],');
  });

  it('renders shell-provider blocks with the command line before overrides', () => {
    const config = {
      provider: 'shell',
      command: 'gemini --model {model} -o json -e none < {file}',
      overrides: buildRoleOverrides('m'),
    };
    const block = renderOrchestratorBlock(config);
    const commandIdx = block.indexOf('command:');
    const overridesIdx = block.indexOf('overrides:');
    expect(commandIdx).toBeGreaterThan(-1);
    expect(overridesIdx).toBeGreaterThan(commandIdx);
    expect(block).toContain("    command: 'gemini --model {model} -o json -e none < {file}',");
  });
});
