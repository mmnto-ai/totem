import { describe, expect, it } from 'vitest';

import type { TotemConfig } from './config-schema.js';
import {
  DocTargetSchema,
  getConfigTier,
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

  it('error message mentions totem init', () => {
    expect(() => requireEmbedding(base)).toThrow('totem init');
  });
});
