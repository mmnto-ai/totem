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
    { glob: '.strategy/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.journal/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
    { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
  ],

  embedding: { provider: 'openai', model: 'text-embedding-3-small' },

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
    { path: 'docs/active_work.md', description: 'Current priorities and next issue triage' },
    { path: 'docs/architecture.md', description: 'Technical architecture and system design' },
  ],

  ignorePatterns: [
    '**/node_modules/**',
    '**/.lancedb/**',
    '**/dist/**',
    '**/__tests__/**',
    '**/*.test.ts',
    '.strategy/archive/**',
    '.strategy/deep-research/**',
    '.strategy/governance-os-thesis/**',
  ],

  shieldIgnorePatterns: ['.totem/lessons/**', 'docs/**', '.changeset/**', '.junie/**', 'README.md', '**/CHANGELOG.md'],
};

export default config;
