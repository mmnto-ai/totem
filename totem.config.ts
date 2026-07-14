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
    // Tenet-16 corollary (mmnto-ai/totem-strategy#800 item 1, cohort sweep
    // 2026-07-14): no ambient `defaultModel` — every LLM-backed role this repo
    // runs is named per-role below instead. Siblings: mmnto-ai/totem-status#97,
    // mmnto-ai/totem-strategy#870.
    //
    // Model refresh 2026-07-14 (operator-ruled): gemini roles → gemini-3.5-flash
    // (GA 2026-05-19; beats 3.1 Pro on coding/agentic at ~25% lower cost, flat
    // long-context pricing, and it is a stable ID where 3.1 Pro is still
    // preview-only); anthropic roles → claude-sonnet-5 (same $ tier as 4.6,
    // near-Opus review quality). Watch-item: if spec/docs prose quality
    // regresses on Flash, revert those two roles to gemini-3.1-pro-preview.
    // Re-evaluate when Gemini 3.5 Pro actually ships.
    overrides: {
      compile: 'anthropic:claude-sonnet-5', // totem-context: valid model ID — Sonnet 5 GA June 2026; shield's known-model lesson predates it
      docs: 'gemini-3.5-flash',
      spec: 'gemini-3.5-flash',
      shield: 'gemini-3.5-flash',
      triage: 'gemini-3.5-flash',
      extract: 'gemini-3.5-flash',
      reviewlearn: 'gemini-3.5-flash',
    },
    // mmnto/totem#1291 Phase 3: dogfood prompt caching against our own
    // compile path. Sonnet 5 caches the static compiler template (~50KB
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
    lanes: ['anthropic:claude-sonnet-5', 'gemini:gemini-3.5-flash'],
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
