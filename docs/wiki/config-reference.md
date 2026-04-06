# Configuration Reference

The `totem.config.ts` file is the heart of your project's governance.

## Full Schema Overview

```typescript
export default {
  // Core Paths
  totemDir: '.totem', // Directory for local storage, lessons, and cache

  // Vector Database Settings
  embedding: {
    provider: 'gemini', // 'openai', 'gemini', 'ollama'
    model: 'gemini-embedding-2-preview',
  },

  // AI Orchestrator Settings
  orchestrator: {
    provider: 'anthropic', // 'shell', 'openai', 'ollama', 'gemini', 'anthropic'
    defaultModel: 'claude-sonnet-4-6',
    options: {
      temperature: 0.1,
      // Provider-specific options like maxTokens or num_ctx
    },
    overrides: {
      // Route specific commands to different models
      spec: 'anthropic:claude-3-7-sonnet-latest',
    },
  },

  // Command-Specific Options
  compileOptions: {
    concurrency: 4, // Max parallel lesson compilations
    cloudFallback: true, // Whether to use Totem cloud API if local fails
  },

  reviewOptions: {
    format: 'json', // Output format: 'text', 'json', 'sarif'
    deterministicOnly: false, // If true, never use the LLM for reviews
  },

  // Tier System (Lite | Standard | Full)
  // Defines the baseline level of strictness and overhead.
  tier: 'Standard',

  // Self-Healing Loop
  shieldAutoLearn: true, // Auto-triggers lesson extraction on FAIL verdicts

  // Targets Configuration
  // Defines how specific files are processed for the knowledge index
  targets: [
    { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
    { glob: 'README.md', type: 'spec', strategy: 'markdown-heading' },
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
  ],

  // Exporters for IDE/Agent Integration
  exports: {
    junie: '.junie/guidelines.md',
    copilot: '.github/copilot-instructions.md',
  },
};
```

## Secrets Management

Totem uses a local `.totem/secrets.json` file to mask sensitive strings during execution and LLM ingestion. Secrets are **never** committed and are explicitly ignored by `.gitignore`.

You can manage this list using the CLI:

```bash
totem add-secret "sk_live_..."
totem add-secret --pattern "(?i)password[=:]\s*\w+"
```

(See [CLI Reference](cli-reference.md) for details on ReDoS protection for secret patterns).
