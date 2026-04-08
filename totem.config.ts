import type { TotemConfig } from '@mmnto/totem';

const config: TotemConfig = {
  targets: [
    { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
    { glob: 'packages/**/*.tsx', type: 'code', strategy: 'typescript-ast' },
    { glob: 'README.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: 'CLAUDE.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.gemini/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: 'docs/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: 'specs/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.journal/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
    { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
  ],

  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },

  orchestrator: {
    provider: 'gemini',
    defaultModel: 'gemini-3-flash-preview',
    overrides: {
      compile: 'anthropic:claude-sonnet-4-6', // totem-context: valid model ID — verified via SDK, shield false-positive (predates Claude 4.6 release)
      docs: 'gemini-3.1-pro-preview',
      spec: 'gemini-3.1-pro-preview',
      shield: 'gemini-3.1-pro-preview',
      triage: 'gemini-3.1-pro-preview',
    },
    // mmnto/totem#1291 Phase 3: dogfood prompt caching against our own
    // compile path. Sonnet 4.6 caches the static compiler template (~50KB
    // ast-grep manual + few-shot) on the first call of a session and reads
    // from cache on every subsequent lesson within the 5-minute TTL window.
    // Default 5m ephemeral covers bulk recompile + multi-lesson CI runs.
    enableContextCaching: true,
  },

  exports: {
    copilot: '.github/copilot-instructions.md',
    junie: '.junie/skills/totem-rules/rules.md',
  },

  docs: [
    { path: 'docs/roadmap.md', description: 'Strategic roadmap with phase progress' },
    {
      path: 'docs/active_work.md',
      description:
        'Current priorities and next issue triage. Only reference OPEN issues — do not include closed or nonexistent issue numbers from prior versions of this document.',
    },
    { path: 'docs/architecture.md', description: 'Technical architecture and system design' },
  ],

  ignorePatterns: [
    '**/node_modules/**',
    '**/.lancedb/**',
    '**/dist/**',
    '**/__tests__/**',
    '.strategy/**',
    '.claude/**',
    'tests/**',
    'scripts/**',
    '.totem/compiled-rules.json',
    '.coderabbit.yaml',
    'README.md',
  ],

  repositories: ['mmnto-ai/totem', 'mmnto-ai/totem-strategy'],

  linkedIndexes: ['.strategy'],

  partitions: {
    core: ['packages/core/'],
    cli: ['packages/cli/'],
    mcp: ['packages/mcp/'],
  },

  shieldIgnorePatterns: [
    '.totem/lessons/**',
    '.strategy',
    'packages/cli/src/assets/compiled-baseline.ts',
  ],
};

export default config;
