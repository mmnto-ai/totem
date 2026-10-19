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
      // The legs arm's OWN enforcement, at any tier (mmnto-ai/totem#2771):
      // 'block' | 'advisory'; unset keeps the tier-derived behaviour.
      enforce: 'block',
    },

    // The strict shield gate's OWN exit knob (mmnto-ai/totem#2525):
    // 'block' | 'advisory' | 'advisory-when-legged'; unset keeps today's exits.
    shield: {
      enforce: 'advisory-when-legged',
    },
  },
};
```

## The Relevance Floor (`searchRelevanceFloor`)

**Optional, and it ships with NO default** (mmnto-ai/totem#2727). Omit the key and no floor applies anywhere.

**What it is.** A refusal threshold compared against the **best** vector-leg relevance of **one retrieval** — a whole-run gate, not a per-item filter. Nothing in Totem withholds an individual sub-floor hit while returning its siblings. Two consumers read it:

1. the MCP `search_knowledge` tool: when a response's best relevance falls below the floor it answers `status="no_useful_hits"` and discloses the below-floor candidates (path + relevance, no content) instead of returning them — and a retrieval whose EVERY hit is faulted (a relevance that is not a finite number in [0, 1]) answers `no_useful_hits` too, floor or no floor, with the faulted count in the envelope (mmnto-ai/totem#2770);
2. `totem spec` (mmnto-ai/totem#2700): an unanchored free-text run is REFUSED when the best relevance is below the floor — the refusal names the value and this key, exits non-zero, and writes no run artifact. `--raw` is exempt.

**Hits with no vector leg are floor-EXEMPT.** A keyword-only (FTS) hit carries no comparable relevance, so absence of a signal is never read as a weak signal — and in `totem spec` a single exempt hit **from a grounding partition** (specs, sessions, code) saves the run. **A hit whose relevance fails the range predicate is FAULTED** (NaN, infinite, or outside [0, 1] — under `l2` only a negative distance, an SDK or data fault the search layer tallies): neither signal nor exemption in both readers, it can never raise the best relevance and cannot save a run or a batch; on a withheld arm it is disclosed by path as `relevance faulted`, and on a batch that proceeds on its real signal it is returned with its field reading `faulted` instead of a number. Lessons are never judged by that gate — they do not ground a run (ruled final, mmnto-ai/totem#2727) — so a keyword-only lesson hit does not save it.

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

## The Enforcement Knob (`hooks.legsOwed.enforce`)

Optional; `'block'` or `'advisory'` (mmnto-ai/totem#2771). It decides what `totem legs gate` **exits** — never what it prints — and it wins over the hook tier in both directions:

- **`'block'`**: the gate exits its derived state — `3` owed with no fresh deposit, `2` could not derive — at EVERY tier, so the managed pre-push hook refuses a legs-owed push on a standard-tier install too, while the spec-evidence and shield gates stay at the repo's tier. This is the per-arm shape the cohort asked for: one gate armed without arming all three.
- **`'advisory'`**: every derived gate state exits `0` at every tier, the strict one included, and on agent seats (a failure before the derivation — an unloadable config — still exits non-zero).
- **Unset**: the tier-derived behaviour — the strict tier and agent seats block, the other tiers print the same lines and pass. Nothing changes on upgrade.

It is read at run time by the gate itself, like the globs, so setting it needs no `totem hook install --force`. When it is set the gate prints one extra line under either tier — `[Totem] legs: hooks.legsOwed.enforce = block` — so a block on a standard-tier install names the key that caused it, and a strict install softened to advisory says so too.

**The CI arm reads the same knob.** A workflow step running `totem legs gate` exits the derived state with the knob unset or `'block'`; `'advisory'` softens that step as well. A repo adopting the CI arm of the `legs-gate` parity row (a hard `totem legs gate` step in its lint workflow over deposits committed under `.totem/artifacts/legs/`) therefore leaves the knob unset or sets `'block'` — Totem's own repository takes the CI arm with the knob unset, so its local pushes stay advisory and its pull requests are gated.

**The floor sees the unfiltered diff.** The gate resolves the same branch-vs-base scope the push gate lints, but with the ignore configuration EMPTY: neither `ignorePatterns` nor `shieldIgnorePatterns` can hide a path from the floor. Those keys carry index-exclusion semantics that were merged into the review/lint diff filter for back-compat, and letting them narrow this predicate would mean a repo that keeps `README.md` out of its index silently stops owing a leg for its public copy. Every run discloses it: `[Legs] Diff source: branch-vs-base (unfiltered — ignorePatterns do not apply to the floor)`.

## The Shield Exit Knob (`hooks.shield.enforce`)

Optional; `'block'`, `'advisory'` or `'advisory-when-legged'` (mmnto-ai/totem#2525). It decides what a `totem review --gate` run **exits** when it fails — the run that the managed pre-push hook makes on the strict tier and on agent seats. It does not change a lane, a prompt, a verdict or the reviewed-content stamp; it changes the exit status and adds one line, plus — under `advisory-when-legged` only — the legs gate's own corrupt-deposit sensor rows, which the derivation prints rather than drops.

- **`'advisory'`**: every failure raised after the config is loaded exits `0`. The run prints the same error text it prints today, then `[Totem] shield: hooks.shield.enforce = advisory`. That includes a lane's own config-class refusal such as `No model specified`, not only a round in which no lane completed.
- **`'advisory-when-legged'`**: the same softening, applied only when `totem legs gate` derives evidence for HEAD — a legs-owed push whose deposit the legs gate accepts. The line names the deposit and its coverage: `[Totem] shield: hooks.shield.enforce = advisory-when-legged (legs deposit <sha8> covers K/N)`. A push that is not legs-owed, an owed push with no fresh deposit, and a legs derivation that fails all keep the block, and the line says which. The legs gate reads no deposit for a push that is not legs-owed, so a repo that wants code pushes covered widens `hooks.legsOwed.globs`.
- **`'block'`**: the explicit spelling of the default — a failure exits non-zero — plus the line `[Totem] shield: hooks.shield.enforce = block`. It does not arm a standard-tier install: the managed hook runs the shield only on the strict tier and agent seats, and this knob does not change that (unlike `hooks.legsOwed.enforce: 'block'`).
- **Unset**: a `--gate` run prints and exits as before, with no extra line.

It is read at run time by `totem review --gate` itself, so setting it needs no `totem hook install --force`, and the rendered hook is unchanged. The line prints on a passing gate run too, so a reader can see which key is in force. On a run that still fails (`'block'`, or `'advisory-when-legged'` without evidence) the knob line prints before the CLI's error; on a softened run the error comes first and the knob line last.

**What stays hard.** A failure raised before the config is loaded — a contradictory flag such as `--gate` with `--fail-on`, a config that does not load, or a `hooks.shield.enforce` value outside the three — exits non-zero under every value. A bare `totem review` (no `--gate`) does not read the knob. The `doctor --strict` step of the same hook block is not affected.

## The Action Policy File (`.totem/action-policy.json`)

The action policy is a separate, tracked JSON file in your configured `totemDir` (`.totem/` unless `totem.config.ts` names another), read by the `action-policy` gate (mmnto-ai/totem#3106). The config schema requires `totemDir` to be a relative path, a directory inside the repository; the policy governs the repository that contains it. An edit to a path a row governs, or a shell statement whose program and leading arguments match a row, is shown, warned on or refused before it runs, according to the row; a shell handed a string the gate does not read is warned on. Totem ships the format and the engine; the rows are yours. Totem never writes or scaffolds this file.

**Shape.** Every field:

- `version` (required): the literal `1`. A file without it, or with any other value, does not load.
- `_note` (optional): a free-text string for the file's readers; ignored by the gate.
- `environments` (optional): a list of `{ name, branches }`. `name` is a kebab-case slug and may not be `any` (that word is reserved for rows that apply on every branch). `branches` is a non-empty list of globs over the current branch name.
- `rows` (required): a list of rows, each with:
  - `id` (required): a kebab-case slug, unique within the file. Verdicts cite it.
  - `action_kind` (required): one of `code_edit`, `secret_read`, `db_migration`, `db_data_write`, `deploy_config_change`, `deploy_trigger`, `scheduled_job_change`, `index_rebuild`.
  - `scope` (required): `{ paths?, commands? }`, with at least one non-empty list. `paths` are path globs; `commands` are command patterns.
  - `environment` (optional): `any` (the default) or the `name` of a declared environment.
  - `disposition` (required): `display`, `warn` or `deny`.
  - `reason` (optional): the text the verdict carries; without it the verdict names the row.

**Every object is strict.** An unknown key anywhere in the file (a typo such as `enviroment` on a row or `command` in a scope) fails the load and names the key's path, so a misspelling can never silently drop a row's governance. The freeze file is read leniently; this file is not.

**Example** with four rows: a `deny` path row, a `display` path row, a `deny` command row that applies only on production branches, and a row that governs the policy file and the hook settings themselves.

```json
{
  "version": 1,
  "_note": "Governed action classes for this repository.",
  "environments": [{ "name": "prod", "branches": ["main", "release/*"] }],
  "rows": [
    {
      "id": "migrations",
      "action_kind": "db_migration",
      "scope": { "paths": ["db/migrations/**"] },
      "disposition": "deny",
      "reason": "migrations ship through the release train"
    },
    {
      "id": "app-code",
      "action_kind": "code_edit",
      "scope": { "paths": ["src/app/**"] },
      "disposition": "display"
    },
    {
      "id": "prod-migrate",
      "action_kind": "db_migration",
      "scope": { "commands": ["pnpm db:migrate:prod"] },
      "environment": "prod",
      "disposition": "deny"
    },
    {
      "id": "gate-config",
      "action_kind": "deploy_config_change",
      "scope": {
        "paths": [".totem/action-policy.json", ".claude/settings.json", ".claude/hooks/**"]
      },
      "disposition": "deny",
      "reason": "the policy and its hooks change by review, not by the agent"
    }
  ]
}
```

Nothing governs the policy file or the hook settings unless you write a row for them, as `gate-config` does above.

**Path globs.** A `paths` entry is a glob in Totem's path-classifier dialect, matched against the edited file made relative to the repository root (the directory holding `.git`, found by walking up from the `totemDir`; the `totemDir`'s parent when there is no repository), with `/` separators. `**` crosses directories, `*` and `?` stay within one segment, braces expand (`*.{yml,yaml}`), and a bare name is anchored at the root (`README.md` matches only the root README, never `docs/README.md`). Backslashes in the edited path are normalized first, and a path outside the repository is never governed. A glob is refused at load when it starts with `/`, `\` or a drive letter (globs are repo-relative), or with `../`, `./` or `~` (no repo-relative path starts that way), or carries more than three `*` (`**` counts two; `**/*.sql` and `db/**/migrations/*.sql` load, `*a*a*a*b` does not). An edited path longer than 1024 characters is compared by its first 1024 characters against a glob with a wildcard, and whole against a literal glob.

**Command patterns.** A `commands` entry is a **token-prefix pattern**: it is split on whitespace, and it matches a shell statement whose program and the arguments after it equal the pattern's tokens in order, each token compared as a glob in the same dialect. Within a token, `*` stops at `/` and `**` crosses it, so `psql **` matches `psql postgres://host/db`. Each pattern token may carry at most two `*` (`**` counts two), and a statement token longer than 1024 characters is compared by its first 1024 characters against a wildcard token and whole against a literal one.

_Which statements are read._ A command is split into statements the way the transport shield splits it, at `&&`, `||`, `;`, `|`, `&` and newlines. The bodies of `$( … )` substitutions are read as statements, and on the Bash tool so are backtick substitutions (on PowerShell the backtick is the escape character and is not read), each nested to four levels. A heredoc body is text, not a statement; in an unquoted-delimiter heredoc (`<<EOF`) the `$( … )` and backtick substitutions inside the body are read, because the shell runs them, while a quoted-delimiter body (`<<'EOF'`, `<<"EOF"`) is text throughout. A PowerShell here-string (`@" … "@`) is not parsed as one: it reads as a double-quoted string, so a `$( … )` inside it is read as a substitution.

_Where the program is._ The program is the first token after `VAR=value` assignments, the reserved words that can stand before a program (`{`, `if`, `then`, `else`, `elif`, `do`, `while`, `until`, `!`, `time`), a function header (`f() {`, `function f {`; the locator reads any `name {` as one, so `echo { x }` reads `x` as the program), and the wrappers below, each recognised by its basename (so `/usr/bin/sudo` counts) with its options skipped:

| Wrapper              | Options that take a separate value                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `sudo`               | `-u -g -C -D -h -p -r -t -T -U --user --group --host --prompt --chdir`                                    |
| `env`                | `-u -C -S --unset --chdir --split-string`                                                                 |
| `nice`               | `-n --adjustment`                                                                                         |
| `nohup`              | none                                                                                                      |
| `time`               | `-f -o --format --output`                                                                                 |
| `xargs`              | `-n -I -L -P -d -a -s -E --max-args --replace --max-lines --max-procs --delimiter --arg-file --max-chars` |
| `command`, `builtin` | none                                                                                                      |
| `exec`               | `-a`                                                                                                      |
| `busybox`            | none; the next token is the applet, so `busybox sh -c` is a shell                                         |

A `--` ends a wrapper's options, `--opt=value` is one token, the token after a listed option is its value, and an option the table does not list is skipped as a flag, so its value, if it had one, is read as the program (`sudo -R /chroot pnpm …` reads `/chroot` as the program).

_How the program is compared._ The pattern's first token is compared against the program token, against its name after the last `/` (so `vercel deploy --prod` matches `./node_modules/.bin/vercel deploy --prod`), on PowerShell against its name after the last backslash too (`C:\tools\pnpm`), and against the token with a leading `./` dropped (so `scripts/deploy.sh` matches `./scripts/deploy.sh`). A `.exe` or `.cmd` spelling is compared by its stem, in any letter case, after the last `/` or `\`. `pnpm db:migrate:prod` matches `cd apps/api && sudo -u deploy pnpm db:migrate:prod --force`; it does not match `pnpm db:migrate:prod-report`, because a longer token is not the pattern's token, and it does not match `echo pnpm db:migrate:prod`, because `echo` is the program.

**Identity is lexical and case-sensitive.** A path or program matches by its spelling, in its letter case (except the `.exe`/`.cmd` stem above). On a case-insensitive file system, write the row for the spelling the agent uses.

**Shell strings.** When the policy has at least one command row, the gate returns `warn` citing `opaque-shell-string` for a statement whose program, after the wrapper skip, is:

- `eval`;
- `sh`, `bash`, `zsh`, `dash` or `ksh` with a `-c` in a short-option cluster before its first non-option argument (`bash -lc '…'`; `bash script.sh -c foo` is a script run, not a string);
- `pwsh` or `powershell` with an option that is a case-insensitive prefix of `-command` (at least `-c`) or of `-encodedcommand` (at least `-e`), or `-ec`;
- `cmd` with `/c` or `/k`, glued text included (`/c"dir"`);
- any of those shells fed text on stdin by a heredoc or here-string, glued or spaced (`bash<<EOF`, `bash <<'EOF'`, `bash<<<x`, `sh 0<<EOF`);
- any of those shells with no script argument (with `-s`, the arguments after the options are parameters, not a script) while a pipe feeds it (`curl … | sh`) or an input redirection does (`sh < install.sh`).

It never denies on such a statement and never allows it silently. A `warn` or `deny` row that matches elsewhere in the same command speaks instead; a lone `display` row does not.

**Environments.** A row naming an environment applies only when the current branch matches one of that environment's `branches` globs. The current environments are every declared environment whose globs match, so a branch can be in `staging` and `prod` at once and a `prod` row applies on it. The branch is read once with `git branch --show-current`, and only when a row that matched the path or command names an environment; a policy whose matching rows are all `any` never runs git. When git cannot report a branch (a detached HEAD, the middle of a rebase, or git unavailable), the environment rows that matched are skipped and listed in the verdict's `skippedForEnvironment`, and the result is unevaluable, `environment-unevaluable`, capped at those rows' own dispositions: a skipped `deny` row gives `deny` at the strict tier and `warn` at the pilot tier, a skipped `warn` or `display` row gives `warn`, and it is never an allow. A `deny` from a matching `any` row still stands in that case.

**Several rows.** When more than one row matches, the most severe disposition wins (`deny` over `warn` over `display`), ties going to the earlier row; the others are listed in the verdict's `alsoMatched`.

**How a verdict reaches the agent.** A `warn` row, and a `display` row (the gate contract has three verdicts, so `display` is reported through the `warn` arm with `policyDisposition: "display"` in its provenance), never block at either tier: the call proceeds, and the reason reaches the agent beside the tool result through the hook's context field, as well as on stderr. A `deny` at the strict tier blocks the call, and its reason reaches the agent as the blocked call's error; at the pilot tier it is reported the way a `warn` is.

**The override.** `TOTEM_ACTION_POLICY_OVERRIDE` is a comma-separated list of row ids. When every `deny` row that matched the call is named in it, the `deny` is cleared: the verdict becomes `allow`, its provenance records `overriddenBy` and the overridden rows, and the gate prints one stderr line naming them, unless another statement in the same command is a shell string, whose `warn` is then the verdict. When any matching `deny` row is not named, the verdict stays `deny` and cites the first unnamed one, so you see what still blocks; when a `deny` row naming an environment was skipped because the branch could not be read, the override is refused and the verdict cites that skipped row and says why. It never touches a `warn` or `display` verdict. The hook reads the environment of the process running it (the agent session or the harness that launched it), so the variable is set there, before the command is attempted; an inline `TOTEM_ACTION_POLICY_OVERRIDE=… command` prefix is part of the command text, not an override.

**Absent and corrupt files.** With no file, nothing is governed: every call is allowed with `no-policy-file`, `totem orient` omits its ACTION POLICY section, and `totem doctor` reports "No action policy (none configured)". A file that does not parse or does not match the schema (an unknown kind or key, a duplicate id, an empty scope, an absolute, never-relative or over-wild glob, an undeclared environment, a missing `version`) never yields a verdict: the gate fails closed and blocks at every tier, `totem doctor` warns naming the file and the first error, and `totem orient` prints one error line for the section.

**What the gate does not read.** The gate reads the command text the agent sends, through the readers above and no others. These match no command row and are allowed as `no-policy-match`:

- a renamed program (an alias, a copy, a symlink under another name), and a script the agent wrote and then runs;
- an interpreter's string: `python -c`, `node -e`, `ruby -e` and their kin;
- a command reached through another program's arguments, as with `find -exec` or the program `xargs` reads from its input;
- `Invoke-Expression` and `env -S` strings;
- a process substitution `<( … )`, a `case` arm, and a substitution nested deeper than four levels;
- a PowerShell here-string's body as anything but a double-quoted string;
- a program reached through an option the wrapper table does not list as taking a value.

Add rows for the wrapper shapes your repository uses; actions outside the rows stay with whoever runs the session.

## Secrets Management

Totem uses a local `.totem/secrets.json` file to mask sensitive strings during execution and LLM ingestion. Secrets are **never** committed and are explicitly ignored by `.gitignore`.

You can manage this list using the CLI:

```bash
totem add-secret "sk_live_..."
totem add-secret --pattern "(?i)password[=:]\s*\w+"
```

(See [CLI Reference](cli-reference.md) for details on ReDoS protection for secret patterns).
