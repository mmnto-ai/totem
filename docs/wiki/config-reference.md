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

  // OPTIONAL, and NO DEFAULT (mmnto-ai/totem#2727). Omit it and no floor
  // applies. See "The relevance floor" below before setting one.
  // The relevance being floored is METRIC-BOUND (mmnto-ai/totem#2738):
  // relevance = relevanceFromDistance('l2', _distance), and `l2` is the metric
  // every Totem vector query is explicitly issued with. LanceDB's `_distance`
  // under `l2` is the SQUARED Euclidean distance, so on unit-norm vectors it
  // lies in [0, 4] and the relevance 1/(1+_distance) lies in [0.2, 1] — on
  // unit-norm vectors a floor below 0.2 can never fire at all (a non-unit-norm
  // embedder is not bounded that way; see "The Relevance Floor" below).
  // searchRelevanceFloor: 0.57,

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

## The Relevance Floor (`searchRelevanceFloor`)

**Optional, and it ships with NO default** (mmnto-ai/totem#2727). Omit the key and no floor applies anywhere.

**What it is.** A refusal threshold compared against the **best** vector-leg relevance of **one retrieval** — a whole-run gate, not a per-item filter. Nothing in Totem withholds an individual sub-floor hit while returning its siblings. Two consumers read it:

1. the MCP `search_knowledge` tool: when a response's best relevance falls below the floor it answers `status="no_useful_hits"` and discloses the below-floor candidates (path + relevance, no content) instead of returning them — and a retrieval whose EVERY hit is faulted (a relevance that is not a finite number in [0, 1]) answers `no_useful_hits` too, floor or no floor, with the faulted count in the envelope (mmnto-ai/totem#2770);
2. `totem spec` (mmnto-ai/totem#2700): an unanchored free-text run is REFUSED when the best relevance is below the floor — the refusal names the value and this key, exits non-zero, and writes no run artifact. `--raw` is exempt.

**Hits with no vector leg are floor-EXEMPT.** A keyword-only (FTS) hit carries no comparable relevance, so absence of a signal is never read as a weak signal — and in `totem spec` a single exempt hit **from a grounding partition** (specs, sessions, code) saves the run. **A hit whose relevance fails the range predicate is FAULTED** (NaN, infinite, or outside [0, 1] — under `l2` only a negative distance, an SDK or data fault the search layer tallies): neither signal nor exemption in both readers, it can never raise the best relevance, is disclosed by path with `relevance faulted` rather than a number, and cannot save a run or a batch. Lessons are never judged by that gate — they do not ground a run (ruled final, mmnto-ai/totem#2727) — so a keyword-only lesson hit does not save it.

**With the key unset there is no floor at all**: the below-floor arms of `no_useful_hits` and the spec refusal cannot fire (each reader's all-faulted arm still can — it needs no floor). The retrieval envelope prints `floor="none"`. `totem spec`'s zero-hit refusal is unaffected — it is a separate arm and still fires. The MCP `min_relevance` input applies per call regardless, and still overrides a configured value.

**Why no default.** Relevance is `1 / (1 + squared L2)` on unit-norm vectors, so it ranges over `[0.2, 1]` and real retrievals sit high in that range. Measured on the gemini-embedding-2-preview 768-d profile over 55 recorded `totem spec` queries, the **lowest** best-relevance of any run was **0.559** (0.5687 over the runs the spec refusal was eligible to judge at all). `0.25` sits inside the reachable range, but it **fired on none of those 55** — a mechanism claim with no mechanism — and any value below a repo's own measured floor is inert the same way. The reachable value is a property of a corpus, its embedder and its labels, so it is yours to set, not ours to guess. The worked measurement is the R4 record at `.totem/fixtures/floor-arm-2026-09-03/` in this repo.

**If your embedder does not return unit-norm vectors** (some custom providers, some Ollama models), the `[0.2, 1]` bound does not hold and relevances below `0.25` are reachable — so on that profile the old default could fire, and removing it may mean **fewer** refusals and fewer `no_useful_hits` than before. Set a value to restore them; calibrate it the same way.

**Choosing a value — one key, two consumers.** The number you pick governs `totem spec`'s refusal AND every `search_knowledge` answer, and those two do not see the same relevances. `search_knowledge` retrieves over every content type, including the **lesson** pool, and lessons score markedly lower than specs and code: on this repo's profile they sit around `0.34`, and an issue-anchored MCP retrieval starts being withheld from about `0.638`. So a value chosen only to refuse weak `totem spec` runs can quietly empty MCP answers over lessons. Calibrate with both in view.

1. Record real runs — an `.totem/artifacts/` sweep of `totem spec` runs over queries you actually ask; each run's grounding items carry their relevance. Beside them, record the `bestRelevance` from the `<retrieval-envelope>` of real `search_knowledge` calls, including ones that should return lessons.
2. Mark the runs and the MCP calls whose retrieval you would want KEPT (it produced usable grounding) and the ones you would want refused.
3. Note the best relevance of each kept run and each kept MCP call. The floor has to sit **below the weakest thing you still want kept across BOTH** — set it there, or a hair under, or you will refuse work you wanted, or answer a legitimate `search_knowledge` call with `no_useful_hits`.
4. Set `searchRelevanceFloor` to that number. Re-measure whenever the embedder or the corpus changes materially; a floor calibrated on one embedding profile says nothing about another.

If no single value separates what you would keep from what you would refuse — which is the likely outcome when the spec runs and the lesson pool sit far apart — that is a real answer: leave the key unset and let the zero-hit arm and the anchor rules carry the gate, and use the per-call `min_relevance` where you want a floor for one query.

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

**A configured list REPLACES the default; it does not merge with it.** A repo declaring its own contract classes must restate every default entry it still wants — dropping one silently retires that part of the floor. (Totem's own `totem.config.ts` restates all seven before adding its schemas, its routing seam, its hook/template builders and its distributed skills — the latter under BOTH `.agents/skills/**` and `.claude/skills/**`, because the two are written from one constant and a floor that watches only one of them can be walked around by editing the other.)

**An empty array is a parse error, not a synonym for "nothing is owed."** `globs: []` fails config load with `hooks.legsOwed.globs must contain at least one glob — omit the key to take the default floor`. There is deliberately no spelling for disabling the floor by emptying it; omit the key to take the default (the `review.lanes` precedent).

**Bare patterns match by basename.** The matcher is the same dialect `ignorePatterns` uses, so a bare `README.md` matches a file of that name anywhere in the tree — which is what makes it cover every package README, i.e. the npm-public copy. A `!`-prefixed glob is an exclusion, and a file matching any exclusion is never owed whatever positives it also matched.

**Read at run time.** Unlike `hooks.tier`, these globs are never rendered into the hook — the hook calls back into `totem legs gate`, which loads this config itself — so editing the list needs no `totem hook install --force`.

**The floor sees the unfiltered diff.** The gate resolves the same branch-vs-base scope the push gate lints, but with the ignore configuration EMPTY: neither `ignorePatterns` nor `shieldIgnorePatterns` can hide a path from the floor. Those keys carry index-exclusion semantics that were merged into the review/lint diff filter for back-compat, and letting them narrow this predicate would mean a repo that keeps `README.md` out of its index silently stops owing a leg for its public copy. Every run discloses it: `[Legs] Diff source: branch-vs-base (unfiltered — ignorePatterns do not apply to the floor)`.

## Secrets Management

Totem uses a local `.totem/secrets.json` file to mask sensitive strings during execution and LLM ingestion. Secrets are **never** committed and are explicitly ignored by `.gitignore`.

You can manage this list using the CLI:

```bash
totem add-secret "sk_live_..."
totem add-secret --pattern "(?i)password[=:]\s*\w+"
```

(See [CLI Reference](cli-reference.md) for details on ReDoS protection for secret patterns).
