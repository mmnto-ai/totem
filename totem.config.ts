import type { TotemConfig } from '@mmnto/totem';

const config: TotemConfig = {
  targets: [
    { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
    { glob: 'README.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: 'CLAUDE.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: 'docs/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.strategy/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.totem/**/*.md', type: 'spec', strategy: 'markdown-heading' },
  ],

  embedding: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },

  orchestrator: {
    provider: 'shell',
    command: 'gemini --model {model} -o json -e none < {file}',
    defaultModel: 'gemini-3-flash-preview',
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
