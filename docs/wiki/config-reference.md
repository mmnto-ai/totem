# Configuration Reference

The `totem.config.ts` file is the heart of your project's governance.

## Full Schema Overview

```typescript
export default {
  // Core Paths
  // Directory for local storage, lessons, and cache. Rendered INTO the managed
  // git hooks at install (mmnto-ai/totem#2692) — the strict pre-commit
  // spec-evidence reader, the pre-push gate guards, and the post-merge /
  // post-checkout diff filters all name it — so re-run `totem hook install
  // --force` after changing it, or the installed hooks keep reading the previous
  // directory. Must be relative and non-empty, and must not contain a quote, a
  // dollar sign, a backtick, a non-ASCII character, a newline or a control
  // character (it cannot be quoted safely into a hook, and git C-quotes
  // non-ASCII paths the hooks grep); a backslash is normalised to `/` and a
  // trailing slash is stripped. The hooks additionally refuse `.`, a `..`
  // segment and a leading `-`.
  totemDir: '.totem',

  // Vector Database Settings
  embedding: {
    provider: 'gemini', // 'openai', 'gemini', 'ollama'
    model: 'gemini-embedding-2-preview',
    // Minimum interval between INGEST embedding requests, in milliseconds
    // (mmnto-ai/totem#2562). Paces `totem sync` under per-minute provider
    // quotas — the wall that kills full re-indexes is a rolling per-minute
    // window (Vertex `online_prediction_requests_per_base_model`, 2,000/min
    // default for gemini-embedding-2; observed accounting behaves per content
    // item). GEMINI DEFAULTS TO 4000: multi-text sync batches pace at 4s
    // apart, keeping a re-index safely under the window so it completes
    // instead of dying at ~2k chunks (minutes for a few-thousand-chunk
    // corpus, proportionally longer for larger ones); single-text QUERY
    // embeds (search / MCP) are never paced. Explicit 0 disables pacing.
    // openai defaults to 0; ollama is local and ignores it.
    throttleMs: 4000,
  },

  // AI Orchestrator Settings
  orchestrator: {
    provider: 'anthropic', // 'shell', 'openai', 'ollama', 'gemini', 'anthropic'
    defaultModel: 'claude-sonnet-5',
    options: {
      temperature: 0.1,
      // Provider-specific options like maxTokens or num_ctx
    },
    overrides: {
      // Route specific commands to different models
      spec: 'anthropic:claude-3-7-sonnet-latest',
    },
    capabilities: {
      // Backend admission classes this orchestrator is declared capable of
      // serving ('completion_only' | 'self_grounding_agent'). Absent =
      // ['completion_only']. A caller requesting a class above
      // 'completion_only' that is not declared here fails before any
      // provider invoke.
      admissionClasses: ['completion_only'],
    },
  },

  // Minimum per-hit relevance (the vector-leg similarity, 0..1) below which a
  // retrieval is treated as noise. TWO consumers read it:
  //   1. the MCP `search_knowledge` tool, which reports
  //      `status="no_useful_hits"` instead of returning noise-floor matches;
  //   2. `totem spec` (mmnto-ai/totem#2700), which REFUSES an unanchored
  //      free-text run when every signal-bearing hit is below this floor and
  //      no keyword-only (floor-exempt) hit exists — the refusal names this
  //      value and this key, exits non-zero, and writes no run artifact.
  // Hits with no vector leg are floor-EXEMPT: absence of a relevance signal is
  // never read as a weak signal. `--raw` is exempt from the spec refusal.
  // MEASURED CAVEAT: on a gemini-embedding index (relevance =
  // 1/(1+distance)) a deliberately nonsensical query still scores far above
  // 0.25 — 0.36 and 0.55 measured on this repo's index at two points — so at
  // the default the below-floor arm cannot fire and only the zero-hit arm
  // does. Calibrating the default is filed as mmnto-ai/totem#2727; raise this
  // value in config to make the below-floor arm reachable for your corpus.
  searchRelevanceFloor: 0.25,

  // Command-Specific Options
  compileOptions: {
    concurrency: 4, // Max parallel lesson compilations
    cloudFallback: true, // Whether to fall back to the Totem cloud worker if local compile fails. Local compile (scaffolded default Claude Sonnet 5) is the golden path; the cloud worker stays Gemini-only — the migration to Claude was considered and declined (mmnto-ai/totem#1221, closed not-planned).
  },

  // Review configuration. `TotemConfigSchema` reads only the `review` key
  // (a flat `reviewOptions` is not in the schema). All review-related
  // settings live here.
  review: {
    // Stage 4 verification baseline (mmnto-ai/totem#1683)
    stage4Baseline: {
      // Globs added to the default baseline (test/fixture patterns).
      // Files matching these globs are treated as out-of-scope when a
      // compiled rule fires on them — same semantics as the default
      // `**/*.test.*` / `**/__tests__/**` / `**/fixtures/**` set.
      extend: ['**/legacy/**', 'tools/scripts/**'],

      // Globs removed from the default baseline. Use this when your
      // project legitimately treats one of the default baseline paths
      // as production code (e.g. a project where `tests/` ships at
      // runtime).
      exclude: ['**/tests/**'],
    },
  },

  // ECL cohort completeness roster (mmnto-ai/totem#2310). Read only by
  // `totem ecl-gc --compact`: the declared set of cohort repos whose ECL
  // outboxes a "provably complete" poll must scan before a processed-mark is
  // collected. Values are bare workspace DIRECTORY names (siblings of the
  // workspace root), NOT `owner/repo` slugs. Omit the whole `ecl` block to
  // leave the roster UNDECLARED — compaction then hard-aborts (exit 3,
  // fail-loud), never a silent no-op. An EMPTY `cohortRepos: []` is a config
  // ERROR (rejected at load), not a synonym for undeclared; a single-repo
  // consumer declares a roster of one.
  ecl: {
    cohortRepos: ['totem', 'totem-strategy', 'totem-status', 'liquid-city'],
  },

  // The `.totemignore` file at the repo root supports a parallel directive
  // syntax: lines of the form `# stage4-baseline: <glob>` are appended to
  // the resolved Stage 4 baseline at compile time. Use this for globs
  // that semantically belong with `.totemignore` content rather than
  // with config (e.g. patterns generated by tooling). Naming: use
  // `baseline`. The schema rejects an `allowlist` key at config-parse
  // time per ADR-091 Deferred Decisions.

  // Tier System (Lite | Standard | Full)
  // Defines the baseline level of strictness and overhead.
  tier: 'Standard',

  // Lesson-extraction prompt on review failure
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

  // Enforcement hook configuration.
  hooks: {
    // The tier rendered INTO the managed hooks at install — re-run
    // `totem hook install --force` after changing it.
    tier: 'standard', // 'strict' | 'standard'

    // The judgment-dense path floor `totem legs gate` judges a push against
    // (mmnto-ai/totem#2698). See the section below.
    legsOwed: {
      globs: ['doctrine/**', 'adr/**', 'docs/wiki/**', '.changeset/**'],
    },
  },
};
```

## The Legs-Owed Floor (`hooks.legsOwed.globs`)

`totem legs gate` calls a push **legs-owed** when a changed path in the branch-vs-base diff matches one of these globs. An owed push must carry a falsification-leg deposit for its head; under the strict tier the pre-push hook blocks without one (see [Enforcement Model](enforcement-model.md)).

**The default floor** — used when the key is absent — is the doctrine surfaces, the public-copy surfaces, and one contract proxy:

```text
doctrine/**
design-tenets.md
adr/**
proposals/**
README.md
docs/wiki/**
.changeset/**
```

`.changeset/**` is in the default deliberately: a changeset IS the release's compatibility contract, so every releasable slice is owed a leg by derivation rather than by anyone remembering to declare it.

**A configured list REPLACES the default; it does not merge with it.** A repo declaring its own contract classes must restate every default entry it still wants — dropping one silently retires that part of the floor. (Totem's own `totem.config.ts` restates all seven before adding its schemas, its routing seam, its hook/template builders and its distributed skills.)

**An empty array is a parse error, not a synonym for "nothing is owed."** `globs: []` fails config load with `hooks.legsOwed.globs must contain at least one glob — omit the key to take the default floor`. There is deliberately no spelling for disabling the floor by emptying it; omit the key to take the default (the `review.lanes` precedent).

**Bare patterns match by basename.** The matcher is the same dialect `ignorePatterns` uses, so a bare `README.md` matches a file of that name anywhere in the tree — which is what makes it cover every package README, i.e. the npm-public copy. A `!`-prefixed glob is an exclusion, and a file matching any exclusion is never owed whatever positives it also matched.

**Read at run time.** Unlike `hooks.tier`, these globs are never rendered into the hook — the hook calls back into `totem legs gate`, which loads this config itself — so editing the list needs no `totem hook install --force`.

One interaction to know: the gate judges the branch diff AFTER `ignorePatterns` / `shieldIgnorePatterns` filtering, so a path class this config also ignores cannot make a push owed. The filter names every file it drops.

## Secrets Management

Totem uses a local `.totem/secrets.json` file to mask sensitive strings during execution and LLM ingestion. Secrets are **never** committed and are explicitly ignored by `.gitignore`.

You can manage this list using the CLI:

```bash
totem add-secret "sk_live_..."
totem add-secret --pattern "(?i)password[=:]\s*\w+"
```

(See [CLI Reference](cli-reference.md) for details on ReDoS protection for secret patterns).
