import type { TotemConfig } from '@mmnto/totem';

// Proof-kit fixture config — the smallest honest totem consumer. Lint needs
// no model at all; the compile role names one explicitly (Tenet-16 corollary:
// no ambient defaultModel).
const config: TotemConfig = {
  targets: [
    { glob: 'src/**/*.js', type: 'code', strategy: 'typescript-ast' },
    { glob: 'docs/**/*.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
  ],

  orchestrator: {
    provider: 'gemini',
    overrides: {
      compile: 'gemini-3.5-flash',
    },
  },

  // Same discipline as the host repo: the lesson corpus never lints itself.
  shieldIgnorePatterns: ['.totem/lessons/**'],
};

export default config;
