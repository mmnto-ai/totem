import { describe, expect, it } from 'vitest';

import type { TotemConfig } from './config-schema.js';
import {
  DocTargetSchema,
  DoctorConfigSchema,
  GarbageCollectionSchema,
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

  // ─── Caching foundation (mmnto/totem#1291 Phase 1) ─────────────

  it('accepts orchestrator config without enableContextCaching (defaults to undefined)', () => {
    const result = OrchestratorSchema.safeParse(ANTHROPIC_ORCHESTRATOR);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableContextCaching).toBeUndefined();
      expect(result.data.cacheTTL).toBeUndefined();
    }
  });

  it('accepts enableContextCaching: true with default cacheTTL', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      enableContextCaching: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableContextCaching).toBe(true);
      expect(result.data.cacheTTL).toBeUndefined();
    }
  });

  it('accepts enableContextCaching with explicit 5-minute cacheTTL', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      enableContextCaching: true,
      cacheTTL: 300,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cacheTTL).toBe(300);
    }
  });

  it('accepts enableContextCaching with extended 1-hour cacheTTL', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      enableContextCaching: true,
      cacheTTL: 3600,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cacheTTL).toBe(3600);
    }
  });

  it('rejects negative cacheTTL', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      enableContextCaching: true,
      cacheTTL: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero cacheTTL', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      enableContextCaching: true,
      cacheTTL: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects fractional cacheTTL (must be integer seconds)', () => {
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      enableContextCaching: true,
      cacheTTL: 300.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unsupported cacheTTL values like 600 (only 300 and 3600 are valid)', () => {
    // mmnto/totem#1291 PR mmnto/totem#1292 review fix from CodeRabbit: cacheTTL
    // must be constrained to the literal values Anthropic supports (300 = 5m
    // default ephemeral, 3600 = 1h extended cache). Any other positive integer
    // would silently fall through to 5m at provider-invocation time, which is
    // confusing and untestable. Better to fail at config-parse time.
    //
    // Asserts the failure is specifically on the `cacheTTL` field path
    // rather than relying on the overall safeParse failing — addresses
    // a Shield AI WARN that the loose form might be a false positive if
    // some other required field were missing. Every other field in this
    // payload is valid (provider literal, enableContextCaching boolean),
    // so the error path MUST land on cacheTTL.
    const unsupported = [60, 600, 1200, 1800, 7200, 86_400];
    for (const ttl of unsupported) {
      const result = OrchestratorSchema.safeParse({
        provider: 'anthropic',
        enableContextCaching: true,
        cacheTTL: ttl,
      });
      expect(result.success, `cacheTTL: ${ttl} should be rejected`).toBe(false);
      if (!result.success) {
        const cacheTTLIssues = result.error.issues.filter((i) => i.path[0] === 'cacheTTL');
        expect(
          cacheTTLIssues.length,
          `cacheTTL: ${ttl} should produce a cacheTTL-specific error`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('coexists with the orthogonal cacheTtls (#52) field', () => {
    // enableContextCaching (prompt cache, mmnto/totem#1291) and cacheTtls (response
    // cache, #52) live at the same level but control different layers.
    // A config setting both should parse cleanly with no interaction.
    const result = OrchestratorSchema.safeParse({
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      cacheTtls: { triage: 3600, shield: 0 },
      enableContextCaching: true,
      cacheTTL: 300,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cacheTtls).toEqual({ triage: 3600, shield: 0 });
      expect(result.data.enableContextCaching).toBe(true);
      expect(result.data.cacheTTL).toBe(300);
    }
  });

  it('accepts enableContextCaching on every provider variant', () => {
    const variants = [
      { provider: 'shell' as const, command: 'echo {file}', enableContextCaching: true },
      { provider: 'anthropic' as const, enableContextCaching: true },
      { provider: 'gemini' as const, enableContextCaching: true },
      { provider: 'openai' as const, enableContextCaching: true },
      { provider: 'ollama' as const, enableContextCaching: true },
    ];
    for (const variant of variants) {
      const result = OrchestratorSchema.safeParse(variant);
      expect(result.success).toBe(true);
    }
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

// ─── Garbage collection config ──────────────────────

// ─── Review source extensions (mmnto/totem#1527) ──────

describe('review.sourceExtensions', () => {
  it('normalizes missing dots and rejects shell-unsafe characters', () => {
    // Accepts both "ts" and ".ts", normalizes to leading-dot form.
    const ok = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      review: { sourceExtensions: ['ts', '.rs'] },
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.review.sourceExtensions).toEqual(['.ts', '.rs']);
    }

    // Shell-unsafe inputs rejected.
    const hazards = ['*.ts', 'ts; rm -rf /', '', 'ts js', '.ts`whoami`', '.ts"', ".ts'"];
    for (const bad of hazards) {
      const result = TotemConfigSchema.safeParse({
        targets: BASE_TARGETS,
        review: { sourceExtensions: [bad] },
      });
      expect(result.success, `extension "${bad}" should be rejected`).toBe(false);
    }
  });

  it('defaults to historical hardcoded set when field is absent', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.sourceExtensions).toEqual(['.ts', '.tsx', '.js', '.jsx']);
    }
  });

  it('defaults to historical hardcoded set when review object is empty', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      review: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.sourceExtensions).toEqual(['.ts', '.tsx', '.js', '.jsx']);
    }
  });

  it('rejects explicit empty array', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      review: { sourceExtensions: [] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('sourceExtensions'))).toBe(true);
    }
  });

  it('accepts compound extensions like .d.ts via internal dots', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      review: { sourceExtensions: ['.d.ts'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.sourceExtensions).toEqual(['.d.ts']);
    }
  });

  it('normalizes "ts" and ".ts" to the same stored form', () => {
    const a = TotemConfigSchema.parse({
      targets: BASE_TARGETS,
      review: { sourceExtensions: ['ts'] },
    });
    const b = TotemConfigSchema.parse({
      targets: BASE_TARGETS,
      review: { sourceExtensions: ['.ts'] },
    });
    expect(a.review.sourceExtensions).toEqual(b.review.sourceExtensions);
  });

  it('passthrough tolerates unknown future review fields', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      review: {
        sourceExtensions: ['.ts'],
        futureUnknownField: { nested: 'value' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // passthrough preserves the unknown field on the parsed object
      const asRecord = result.data.review as Record<string, unknown>;
      expect(asRecord['futureUnknownField']).toEqual({ nested: 'value' });
    }
  });
});

describe('GarbageCollectionSchema', () => {
  it('rejects garbage collection config with negative minAgeDays', () => {
    const result = GarbageCollectionSchema.safeParse({ minAgeDays: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts garbage collection with defaults', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      garbageCollection: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const gc = result.data.garbageCollection!;
      expect(gc.enabled).toBe(true);
      expect(gc.minAgeDays).toBe(90);
      expect(gc.exemptCategories).toEqual(['security']);
    }
  });

  it('accepts custom garbage collection config', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      garbageCollection: {
        enabled: false,
        minAgeDays: 30,
        exemptCategories: ['security', 'architecture'],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const gc = result.data.garbageCollection!;
      expect(gc.enabled).toBe(false);
      expect(gc.minAgeDays).toBe(30);
      expect(gc.exemptCategories).toEqual(['security', 'architecture']);
    }
  });

  it('config without garbageCollection is valid', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.garbageCollection).toBeUndefined();
    }
  });
});

// ─── DoctorConfigSchema (mmnto-ai/totem#1483) ────────

describe('DoctorConfigSchema', () => {
  it('parses doctor config with defaults and overrides', () => {
    const defaulted = DoctorConfigSchema.parse({});
    expect(defaulted.staleRuleWindow).toBe(10);
    expect(defaulted.minRunsToEvaluate).toBe(3);

    const overridden = DoctorConfigSchema.parse({ staleRuleWindow: 20, minRunsToEvaluate: 5 });
    expect(overridden.staleRuleWindow).toBe(20);
    expect(overridden.minRunsToEvaluate).toBe(5);
  });

  it('rejects doctor.staleRuleWindow less than doctor.minRunsToEvaluate', () => {
    const result = DoctorConfigSchema.safeParse({
      staleRuleWindow: 2,
      minRunsToEvaluate: 5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain('staleRuleWindow');
      expect(result.error.issues[0]!.message).toContain('minRunsToEvaluate');
    }
  });

  it('accepts staleRuleWindow equal to minRunsToEvaluate (boundary)', () => {
    const result = DoctorConfigSchema.safeParse({
      staleRuleWindow: 5,
      minRunsToEvaluate: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects staleRuleWindow below 1', () => {
    const result = DoctorConfigSchema.safeParse({ staleRuleWindow: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects minRunsToEvaluate below 1', () => {
    const result = DoctorConfigSchema.safeParse({ minRunsToEvaluate: 0 });
    expect(result.success).toBe(false);
  });

  it('TotemConfigSchema treats doctor as optional; missing value is undefined', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.doctor).toBeUndefined();
    }
  });

  it('TotemConfigSchema fills DoctorConfigSchema defaults when doctor is present but empty', () => {
    const result = TotemConfigSchema.safeParse({ targets: BASE_TARGETS, doctor: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.doctor).toEqual({ staleRuleWindow: 10, minRunsToEvaluate: 3 });
    }
  });

  it('TotemConfigSchema accepts doctor config overrides', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      doctor: { staleRuleWindow: 50, minRunsToEvaluate: 10 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.doctor?.staleRuleWindow).toBe(50);
      expect(result.data.doctor?.minRunsToEvaluate).toBe(10);
    }
  });

  it('TotemConfigSchema rejects inverted doctor window / floor', () => {
    const result = TotemConfigSchema.safeParse({
      targets: BASE_TARGETS,
      doctor: { staleRuleWindow: 3, minRunsToEvaluate: 10 },
    });
    expect(result.success).toBe(false);
  });
});
