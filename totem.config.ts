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
    { glob: '.totem/**/*.md', type: 'spec', strategy: 'markdown-heading' },
  ],

  embedding: { provider: 'openai', model: 'text-embedding-3-small' },

  orchestrator: {
    provider: 'shell',
    command: 'gemini --model {model} -o json -e none < {file}',
    defaultModel: 'gemini-3-flash-preview',
    overrides: {
      spec: 'gemini-3.1-pro-preview',
      shield: 'gemini-3.1-pro-preview',
      triage: 'gemini-3.1-pro-preview',
    },
  },

  ignorePatterns: [
    '**/node_modules/**',
    '**/.lancedb/**',
    '**/dist/**',
    '**/__tests__/**',
    '**/*.test.ts',
  ],
};

export default config;
