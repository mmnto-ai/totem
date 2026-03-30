import { describe, expect, it } from 'vitest';

import type { TotemConfig } from './config-schema.js';
import {
  DocTargetSchema,
  getConfigTier,
  OrchestratorSchema,
  requireEmbedding,
  TotemConfigSchema,
} from './config-schema.js';

const BASE_TARGETS = [
  { glob: '**/*.md', type: 'spec' as const, strategy: 'markdown-heading' as const },
];

const OPENAI_EMBEDDING = { provider: 'openai' as const, model: 'text-embedding-3-small' };

const SHELL_ORCHESTRATOR = {
  provider: 'shell' as const,
  command: 'echo {file}',
  defaultModel: 'test-model',
};

const GEMINI_ORCHESTRATOR = {
  provider: 'gemini' as const,
  defaultModel: 'gemini-2.5-flash',
};

const ANTHROPIC_ORCHESTRATOR = {
  provider: 'anthropic' as const,
  defaultModel: 'claude-sonnet-4-6',
};

describe('TotemConfigSchema', () => {
  it('accepts config without embedding (Lite tier)', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS });
    expect(result.success).toBe(true);
  });

  it('accepts config with embedding but no orchestrator (Standard tier)', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      embedding: OPENAI_EMBEDDING,
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with embedding and orchestrator (Full tier)', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      embedding: OPENAI_EMBEDDING,
      orchestrator: SHELL_ORCHESTRATOR,
    });
    expect(result.success).toBe(true);
  });

  it('rejects config with no targets', () => {
    const result = TotemConfigSchema.safeParse({ targets: [] });
    expect(result.success).toBe(false);
  });

  it('rejects absolute lanceDir (Unix)', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS, lanceDir: '/tmp/lancedb' });
    expect(result.success).toBe(false);
  });

  it('rejects absolute lanceDir (Windows drive)', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS, lanceDir: 'C:\\lancedb' });
    expect(result.success).toBe(false);
  });

  it('rejects absolute lanceDir (Windows backslash)', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS, lanceDir: '\\lancedb' });
    expect(result.success).toBe(false);
  });

  it('rejects absolute totemDir', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS, totemDir: '/tmp/totem' });
    expect(result.success).toBe(false);
  });

  it('accepts relative lanceDir', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS, lanceDir: '.lancedb' });
    expect(result.success).toBe(true);
  });

  it('accepts config with docs array', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      docs: [
        { path: 'README.md', description: 'Public README', trigger: 'post-release' },
        { path: 'docs/roadmap.md', description: 'Roadmap' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.docs).toHaveLength(2);
      expect(result.data.docs![1].trigger).toBe('post-release'); // default
    }
  });

  it('accepts config without docs (optional)', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.docs).toBeUndefined();
    }
  });
});

// ─── Orchestrator schema ─────────────────────────────

describe('OrchestratorSchema', () => {
  it('accepts shell provider with command', () => {
    const result = OrchestratorSchema.safeParse(SHELL_ORCHESTRATOR);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('shell');
    }
  });

  it('accepts gemini provider', () => {
    const result = OrchestratorSchema.safeParse(GEMINI_ORCHESTRATOR);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('gemini');
    }
  });

  it('accepts anthropic provider', () => {
    const result = OrchestratorSchema.safeParse(ANTHROPIC_ORCHESTRATOR);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('anthropic');
    }
  });

  it('accepts shared fields on all providers', () => {
    const geminiWithShared = {
      provider: 'gemini' as const,
      defaultModel: 'gemini-2.5-flash',
      fallbackModel: 'gemini-2.5-pro',
      overrides: { spec: 'gemini-2.5-pro' },
      cacheTtls: { triage: 3600 },
    };
    const result = OrchestratorSchema.safeParse(geminiWithShared);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultModel).toBe('gemini-2.5-flash');
      expect(result.data.fallbackModel).toBe('gemini-2.5-pro');
    }
  });

  it('accepts openai provider', () => {
    const result = OrchestratorSchema.safeParse({ provider: 'openai' });
    expect(result.success).toBe(true);
  });

  it('accepts openai provider with baseUrl', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3.1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown provider', () => {
    const result = OrchestratorSchema.safeParse({ provider: 'cohere' });
    expect(result.success).toBe(false);
  });

  it('rejects shell provider without command', () => {
    const result = OrchestratorSchema.safeParse({ provider: 'shell', defaultModel: 'test' });
    expect(result.success).toBe(false);
  });
});

// ─── Backwards compatibility ─────────────────────────

describe('orchestrator backwards compatibility', () => {
  it('auto-migrates legacy config without provider to shell', () => {
    const legacyConfig = {
      targets: BASE_TARGETS,
      orchestrator: {
        command: 'gemini -e none < {file}',
        defaultModel: 'gemini-2.5-flash',
      },
    };
    const result = TotemConfigSchema.safeParse(legacyConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orchestrator!.provider).toBe('shell');
    }
  });

  it('preserves all legacy fields after migration', () => {
    const legacyConfig = {
      targets: BASE_TARGETS,
      orchestrator: {
        command: 'gemini -e none < {file}',
        defaultModel: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.5-pro',
        overrides: { spec: 'gemini-2.5-pro' },
        cacheTtls: { triage: 3600 },
      },
    };
    const result = TotemConfigSchema.safeParse(legacyConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      const orch = result.data.orchestrator!;
      expect(orch.provider).toBe('shell');
      expect(orch.defaultModel).toBe('gemini-2.5-flash');
      expect(orch.fallbackModel).toBe('gemini-2.5-pro');
    }
  });

  it('does not inject provider when it is already present', () => {
    const explicitConfig = {
      targets: BASE_TARGETS,
      orchestrator: GEMINI_ORCHESTRATOR,
    };
    const result = TotemConfigSchema.safeParse(explicitConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orchestrator!.provider).toBe('gemini');
    }
  });
});

// ─── Config with API orchestrators ───────────────────

describe('TotemConfigSchema with API orchestrators', () => {
  it('accepts config with gemini orchestrator (Full tier)', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      embedding: OPENAI_EMBEDDING,
      orchestrator: GEMINI_ORCHESTRATOR,
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with anthropic orchestrator (Full tier)', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      embedding: OPENAI_EMBEDDING,
      orchestrator: ANTHROPIC_ORCHESTRATOR,
    });
    expect(result.success).toBe(true);
  });
});

describe('DocTargetSchema', () => {
  it('parses valid doc target', () => {
    const result = DocTargetSchema.safeParse({
      path: 'README.md',
      description: 'Public README',
      trigger: 'post-release',
    });
    expect(result.success).toBe(true);
  });

  it('defaults trigger to post-release', () => {
    const result = DocTargetSchema.parse({
      path: 'README.md',
      description: 'Public README',
    });
    expect(result.trigger).toBe('post-release');
  });

  it('accepts on-change trigger', () => {
    const result = DocTargetSchema.safeParse({
      path: 'docs/architecture.md',
      description: 'Architecture',
      trigger: 'on-change',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid trigger', () => {
    const result = DocTargetSchema.safeParse({
      path: 'README.md',
      description: 'test',
      trigger: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing path', () => {
    const result = DocTargetSchema.safeParse({
      description: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const result = DocTargetSchema.safeParse({
      path: 'README.md',
    });
    expect(result.success).toBe(false);
  });

  it('parses successfully with no userFacing (backward compat)', () => {
    const result = DocTargetSchema.safeParse({
      path: 'README.md',
      description: 'Public README',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userFacing).toBeUndefined();
    }
  });

  it('parses successfully with userFacing: true', () => {
    const result = DocTargetSchema.safeParse({
      path: 'docs/architecture.md',
      description: 'Architecture docs',
      userFacing: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userFacing).toBe(true);
    }
  });

  it('parses successfully with userFacing: false', () => {
    const result = DocTargetSchema.safeParse({
      path: 'README.md',
      description: 'Internal README',
      userFacing: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userFacing).toBe(false);
    }
  });
});

describe('getConfigTier', () => {
  const base: TotemConfig = TotemConfigSchema.parse({ targets: BASE_TARGETS });

  it('returns lite when no embedding and no orchestrator', () => {
    expect(getConfigTier(base)).toBe('lite');
  });

  it('returns standard when embedding is present but no orchestrator', () => {
    const config = { ...base, embedding: OPENAI_EMBEDDING };
    expect(getConfigTier(config)).toBe('standard');
  });

  it('returns full when both embedding and orchestrator are present', () => {
    const config = { ...base, embedding: OPENAI_EMBEDDING, orchestrator: SHELL_ORCHESTRATOR };
    expect(getConfigTier(config)).toBe('full');
  });

  it('returns lite when orchestrator is present but embedding is not', () => {
    const config = { ...base, orchestrator: SHELL_ORCHESTRATOR };
    expect(getConfigTier(config)).toBe('lite');
  });

  it('returns full for gemini API orchestrator', () => {
    const config = { ...base, embedding: OPENAI_EMBEDDING, orchestrator: GEMINI_ORCHESTRATOR };
    expect(getConfigTier(config)).toBe('full');
  });

  it('returns full for anthropic API orchestrator', () => {
    const config = { ...base, embedding: OPENAI_EMBEDDING, orchestrator: ANTHROPIC_ORCHESTRATOR };
    expect(getConfigTier(config)).toBe('full');
  });
});

describe('requireEmbedding', () => {
  const base: TotemConfig = TotemConfigSchema.parse({ targets: BASE_TARGETS });

  it('returns embedding provider when configured', () => {
    const config = { ...base, embedding: OPENAI_EMBEDDING };
    expect(requireEmbedding(config)).toEqual(OPENAI_EMBEDDING);
  });

  it('throws when embedding is undefined', () => {
    expect(() => requireEmbedding(base)).toThrow('No embedding provider configured');
  });

  it('error message mentions Lite tier', () => {
    expect(() => requireEmbedding(base)).toThrow('Lite tier');
  });

  it('error recovery hint mentions totem init', () => {
    try {
      requireEmbedding(base);
    } catch (err) {
      expect((err as { recoveryHint?: string }).recoveryHint).toContain('totem init');
      return;
    }
    throw new Error('Expected requireEmbedding to throw');
  });
});
