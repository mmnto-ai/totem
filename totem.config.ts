import type { TotemConfig } from '@mmnto/totem';

// The org-level GH Project board both cohort repos derive against (the Convergent
// Spine roadmap = `orgs/mmnto-ai/projects/1`). Named so `totem orient`'s board wiring
// reads by intent, not a bare literal.
const ORIENT_PROJECT_NUMBER = 1;

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

  // mmnto-ai/totem#2106 (Prop 304 R2): opt totem itself into the multi-lane
  // review fan — two vendor-distinct lanes over the one masked diff, converging
  // on verdict artifacts under `.totem/artifacts/verdicts/`. First dogfood of
  // the runner on its own repo (Prop 302 T2 evidence source). Explicit
  // `totem review --model ...` stays a one-lane invocation; omit `lanes` to
  // fall back to the legacy single-lane path.
  review: {
    lanes: ['anthropic:claude-sonnet-4-6', 'gemini:gemini-3.1-pro-preview'],
  },

  docs: [
    { path: 'docs/wiki/roadmap.md', description: 'Strategic roadmap with phase progress' },
    {
      path: 'docs/reference/architecture.md',
      description: 'Technical architecture and system design',
    },
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

  // mmnto-ai/totem#2044 (WS2 PR-3): wire the GH Project board into `totem orient`
  // so its board / coherence-drift sections derive instead of rendering
  // honest-absent. `TOTEM_ORIENT_PROJECT` env still overrides at runtime.
  // mmnto-ai/totem#2093 (Prop 292 S1): parityManifest resolves through the
  // `@mmnto/strategy-doctrine` optionalDependencies pin (restricted pkg; npm
  // read-auth required). Unauthed installs skip the optional pin and
  // `doctor --parity` degrades to a non-blocking WARN — expected in public CI.
  orient: {
    projectNumber: ORIENT_PROJECT_NUMBER,
    parityManifest: 'node_modules/@mmnto/strategy-doctrine/parity-manifest.yaml',
  },

  // mmnto-ai/totem#2310: the `totem ecl-gc --compact` A2.2 completeness roster —
  // the cohort repos whose ECL outboxes a provably-complete poll must scan before
  // a processed-mark may be collected. Bare workspace directory names (not
  // owner/repo slugs). This is OUR cohort's frozen active set; its VALUE
  // change-authority is mmnto-ai/totem-strategy#611 (skynet's return flips it
  // there; configs follow in lockstep). Omitting this key would gate-red the
  // /signoff compaction step (exit 3, fail-loud) — declared here so it stays green.
  ecl: {
    cohortRepos: ['liquid-city', 'totem', 'totem-status', 'totem-strategy'],
  },

  // mmnto-ai/totem#1710: the strategy linkedIndex is auto-injected by the
  // MCP context init via `resolveStrategyRoot`. Listing it here is no
  // longer required — the resolver handles env / config / sibling /
  // submodule precedence regardless of where the strategy repo sits.
  // Keep `linkedIndexes` empty unless adding genuinely third-party indexes.
  linkedIndexes: [],

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
