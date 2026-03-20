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
      docs: 'gemini-3.1-pro-preview',
      spec: 'gemini-3.1-pro-preview',
      shield: 'gemini-3.1-pro-preview',
      triage: 'gemini-3.1-pro-preview',
    },
  },

  exports: {
    copilot: '.github/copilot-instructions.md',
    junie: '.junie/skills/totem-rules/rules.md',
  },

  docs: [
    {
      path: 'README.md',
      description: 'Public-facing README with install, usage, and feature overview',
    },
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
    '**/*.test.ts',
    '.strategy/**',
    '.claude/**',
    'tests/**',
  ],

  repositories: ['mmnto-ai/totem', 'mmnto-ai/totem-strategy'],

  linkedIndexes: ['.strategy'],

  partitions: {
    core: ['packages/core/'],
    cli: ['packages/cli/'],
    mcp: ['packages/mcp/'],
  },

  shieldIgnorePatterns: ['.totem/lessons/**', '.strategy'],
};

export default config;
