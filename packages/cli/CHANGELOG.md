# @mmnto/cli

## 1.98.0

### Minor Changes

- 9ff30b9: feat(doctor): `totem doctor --compliance` recall-rate reader + the ADR-029 A.3.a producer stamp (mmnto-ai/totem#2362).

  ADR-029's Compliance Rate (% of coding sessions where `search_knowledge` preceded the first commit) is now a measured sensor rather than a `Goal:` claim. Two halves, one telemetry pair (`.totem/.search-log.jsonl` + git commit timestamps), sensor-only per Tenet 13 — a readout, never a gate.
  - **Producer (`@mmnto/mcp`):** `SearchLogEntry` gains three optional A.3.a fields — `agent_source`, `session_id`, `correlation_id` — stamped at log time from the environment (`TOTEM_SELF_AGENT` / `TOTEM_SESSION_ID` / `TOTEM_CORRELATION_ID`) in one producer touch. Absent env → an explicit `null` (Tenet 4, never guessed). The ~420 pre-schema entries stay permanently unattributed (no retro-inference).
  - **Reader (`@mmnto/cli`):** new `totem doctor --compliance` section computes the rate from the existing log against git history. Sessions follow ADR-029 § 2 verbatim: ONE merged event stream (searches and commits together) in rolling 2-hour windows, repo-wide. The readout shows the repo-wide rate (with n), a "commit-granularity per ADR-029 § 1" caveat, an attribution-coverage diagnostic (entry counts per `agent_source`; null → an explicit "unattributed" bucket) — never per-seat compliance rates, because commits carry no seat identity to join against — low-n honesty ("insufficient data (n=x)" below 5), and the doctor `skip` idiom (not a fail, not 0%) when the log file is absent. `session_id` is stamped as a forward primitive for the commit-side join and is deliberately inert in the current windowing.

  Consumer-impact: new `totem doctor --compliance` section (never affects exit codes); three new optional `SearchLogEntry` fields on the MCP search log (additive — existing log readers unaffected, legacy entries render as unattributed). No breaking changes.

### Patch Changes

- Updated dependencies [ca5aefa]
  - @mmnto/totem@1.98.0

## 1.97.0

### Minor Changes

- faeea5b: feat(review): `lessonsConsulted` — the round's lesson-recall record on the verdict-artifact contract (mmnto-ai/totem#2363, strategy#474 grounding lever).

  Premise correction recorded with the build: lesson recall is ALREADY live on the review-fan path — the fan is dispatched from the standard shield path after `retrieveContext`/`assemblePrompt`, so every lane's prompt carries the lesson checklist and every lane's run artifact carries lesson grounding. What was missing is the CONTRACT line: the verdict artifact had no recall record, so a consumer couldn't read recall status without chasing per-lane run artifacts, and a future runner change could silently drop retrieval without violating any contract.
  - Verdict schema 1.1.0 (additive-optional, F1): `lessonsConsulted` — `{ status: 'hit' | 'empty', items: [{ contentHash, filePath, sourceRepo? }] }`, identity-only (mirrors grounding-item semantics, no content bytes). Three observable states: field ABSENT = producer performed no retrieval (pre-1.1 artifacts — honest-absent, never fabricated); `empty` = retrieval ran, zero lessons (the visibly-ungrounded state the strategy#474 abstain-on-empty rule needs to be checkable); `hit` = identities carried. `status` ⟺ `items` enforced in the artifact superRefine (never mirrored on trust).
  - One field per VERDICT, not per lane — identical-kit discipline makes recall a round-level fact; per-lane provenance stays one hop away in each lane's run-artifact bundle.
  - `deriveLessonsConsulted(bundle)` exported from core (root barrel + `@mmnto/totem/artifacts`): the single home for the bundle→record mapping; the fan derives, never hand-builds.
  - The fan now emits the field on every verdict (derived from the same grounding bundle its lanes carry). Lane-blindness key-set structural test updated deliberately (the new key is recall telemetry, not a runner discriminator).

  Consumer-impact: verdict-artifact schema (additive-optional field; 1.x readers unaffected, written version 1.0.0 → 1.1.0) + new core exports. Existing artifacts parse unchanged.

### Patch Changes

- 0100841: docs(claim-discipline): strategy#531 seam-repair burn-down — package-family description alignment + public-surface register fixes (mmnto-ai/totem#1950 residual class).

  The published package family disagreed with itself: `@mmnto/cli` carries the ruled D1 self-description (mmnto-ai/totem#2336 / mmnto-ai/totem#2349) while `@mmnto/totem` and `@mmnto/mcp` still advertised the retired "persistent memory and context layer" category. Public docs also carried autonomy framing ahead of the mechanism ("automatically heal itself", "takes autonomous action", "no extra setup").
  - `@mmnto/totem` + `@mmnto/mcp` `package.json` descriptions and per-package READMEs re-cut on the D1 descriptive core; drift-locked by per-package parity tests mirroring the CLI's (`description.test.ts` in each package).
  - README + wiki register fixes: canonical plain-file sources vs derived LanceDB index no longer conflated; the IDE-level MCP registration step is named instead of "no extra setup"; `totem spec`'s catch claim is first-person, not a product guarantee; `totem doctor --pr` copy states the real mechanism — telemetry-derived downgrades staged as a PR a human merges — replacing "Self-Healing"/"autonomous" framing; "provides the hard guarantee" residual (mmnto-ai/totem#1950 class) reworded to the mechanical claim.

  Consumer-impact: npm registry metadata (`description` fields) and rendered README/docs pages only; no runtime code paths change (the two new files are tests).

- a5274b7: fix(mail): a seat's own outbound broadcast no longer surfaces as its own unread (mmnto-ai/totem#2364).

  `pollMail` filtered by recipient only, so a seat that broadcast to the cohort read "1 unread" from its own outbox forever unless it hand-backfilled a `processed/_broadcast/` mark (live exhibit: a strategy-seat round-reply broadcast red in every one of that seat's orientations for 8 days). The unread scan now excludes a dispatch when its source outbox belongs to a SELF agent AND `to: broadcast` — keyed on the outbox-owner directory (single-writer filesystem truth, same doctrine as the basename-collision sensor), never the forgeable `from:` header.

  Scope guards: the `includeProcessed` discovery view (ecl-gc compaction, ADR-106 § A2.1) keeps the RAW addressed-inbound set — excluding own-broadcasts there would read existing self-marks as stale and collect marks that must be retained. Directed self-mail (`to:` a SELF agent from an own outbox) stays surfaced; broadcasts are the observed noise class.

  Consumer-impact: `totem mail` unread output + every `pollMail()` consumer (SessionStart hooks, MCP audits) stop counting the polling seat's own broadcasts as unread. Under a dirs-derived multi-seat union view (no `TOTEM_SELF_AGENT` scoping), broadcasts from any unioned seat are treated as "own" — consistent with that view's existing self-set semantics. No schema or flag changes.

- Updated dependencies [0100841]
- Updated dependencies [faeea5b]
  - @mmnto/totem@1.97.0

## 1.96.0

### Minor Changes

- 01c2ed0: fix(config): `indexIgnorePatterns` — index-only exclusions split from lint/shield scope, plus loud disclosure when `ignorePatterns` drops files from a review diff (mmnto-ai/totem#1748, upstream-feedback/046).

  `config.ignorePatterns` is documented as index exclusion but was also silently merged into the lint/shield diff filter — an operator excluding paths from _indexing_ (e.g. `audits/**`, "keep on disk, out of the semantic index") silently disabled _lint_ on those paths (two live exhibits, including a staged lint that dropped audit files with no trace). Conservative composite, no behavior break:
  - New `indexIgnorePatterns` config key (core schema): excluded ONLY from indexing, never from lint/shield scope. Moving index-intent patterns here restores lint coverage immediately.
  - `ignorePatterns` keeps its dual scope for back-compat; its docstring now states the dual scope honestly. The full inheritance split (lint stops consuming `ignorePatterns`) is registered for 2.0.0 in mmnto-ai/totem#1746.
  - Tenet-4 floor at the diff boundary: every review/lint diff derivation now discloses `Filtered N file(s) from the diff per ignorePatterns/shieldIgnorePatterns: ...`, naming each dropped file (capped at 8 + overflow count), so un-migrated configs stop failing silently.

  Consumer-impact: config schema (additive key, no migration required) + lint/shield/review terminal output (new warning line whenever ignore patterns drop files from the derived diff; verdicts, exit codes, and diff contents are byte-identical for runs where the patterns drop nothing).

- 7d24edd: feat(init): generated configs name models per-role — no ambient `defaultModel` — and stamp current-generation IDs (Tenet-16 corollary follow-on, mmnto-ai/totem-strategy#800 item 1).

  `totem init`'s orchestrator detection was the generator of the ambient-default violation class cohort-wide: every generated config committed a concrete `orchestrator.defaultModel`, and the stamped IDs (`gemini-3-flash-preview` / `claude-sonnet-4-6` / `gpt-5.4-mini`) were stale after the 2026-07-14 model refresh. Detection itself is legitimate local-environment resolution at genesis, so it stays; the emitted shape changes to per-role `overrides` covering every LLM-backed role tag (compile/docs/spec/shield/triage/extract/reviewlearn) with current IDs: `gemini-3.5-flash` (Gemini CLI + API branches), `claude-sonnet-5` (Anthropic API), `gpt-5.6-terra` (OpenAI API), the `sonnet` tier alias (claude CLI), `gemma4` (Ollama). The TS-template block is now rendered from the same object serialized into YAML/TOML configs, so the two emission surfaces cannot drift.

  Consumer-impact: `totem init` generated-config surface only — newly generated configs get the per-role shape and current model IDs; existing configs are never rewritten. One behavioral edge: a freshly generated config no longer feeds `totem lesson compile --cloud`'s `defaultModel` fallback, so `--cloud` without `--model` fails loud (CONFIG_INVALID) instead of silently riding the previously-generated vendor default — consistent with the mmnto-ai/totem#2357 ruling. No migration required.

- fa21188: feat(orchestrators): current-generation model support — sampling params reconciled at the provider boundary (mmnto-ai/totem#1476).

  Current-generation models reject client sampling params with a 400 (Anthropic Opus 4.7+/Sonnet 5+/Fable reject `temperature`/`top_p`/`top_k`; OpenAI gpt-5+/o-series additionally reject the legacy `max_tokens` key in favor of `max_completion_tokens`). Previously every Totem LLM role hardcoded a `temperature`, so pointing any override or review lane at a current-generation model failed at runtime — GPT-5-family models could not be used as orchestrators at all.

  `modelStripsTemperature()` (`@mmnto/totem`) widens from the Opus-4.7+-only regex to the cross-provider predicate (Sonnet 5+, Haiku 5+, Fable/Mythos, gpt-5+, o-series; provider-qualified strings accepted), and both the anthropic and openai orchestrator boundaries now consume it: callers keep declaring their intended temperature, and the boundary omits it for models that reject it. The openai orchestrator additionally selects `max_completion_tokens` vs legacy `max_tokens` on the same predicate, so OpenAI-compatible local servers (Ollama, LM Studio, Groq) keep the legacy shape they expect.

  Consumer-impact: orchestrator request shape — configs pointing at Opus 4.7+/Sonnet 5+/Fable or gpt-5+/o-series models now work instead of failing with a 400; requests to models that accept sampling params are byte-identical. `modelStripsTemperature` returns `true` for the new families, which also flows into the compile-worker fingerprint (records temperature absence) for anthropic-provider configs. No config migration required.

### Patch Changes

- d3cf878: fix(mail): the ECL outbox scan no longer follows symlinked agent/outbox directories (mmnto-ai/totem#2355, sibling class to the #2354 ingest guard).

  `enumerateOutboxes` dirent-filtered the workspace and repo levels but the inner agent-level scan used a bare `readdirSync` + `existsSync` (both follow symlinks), so a symlinked `<agent>/` or `outbox/` directory was traversed during the mail poll. The agent level is now dirent-filtered like the outer levels (and like `orchestration-resolver.ts`, which is no-follow by design), and the outbox probe is an lstat-based no-follow directory check.

  Consumer-impact: `totem mail` scan enumeration only — symlinked agent/outbox directories under `.totem/orchestration/` are skipped instead of followed; regular directories scan identically. Severity was bounded to enumeration/display (not index persistence). No migration required.

- d8b0287: fix(compile): cloud compile fails loud when no model is resolvable instead of silently substituting a hardcoded vendor default (Tenet-16 corollary, mmnto-ai/totem-strategy#800 item 1).

  The `--cloud` request body's `model` field fell back to a concrete `'gemini-3-flash-preview'` where the three manifest-provenance sibling sites fall back to `'unknown'`. Unlike those provenance stamps, this is a live request parameter sent to the cloud worker — so the fix is not `'unknown'` but a loud `CONFIG_INVALID` error before any token exec or network call when neither `--model` nor `orchestrator.defaultModel` resolves.

  Consumer-impact: CLI surface — `totem lesson compile --cloud` invoked with no `--model` and no `orchestrator.defaultModel` now errors loudly instead of silently compiling via an undeclared vendor model. Cloud runs with an explicitly resolved model are byte-identical; the local compile path is untouched.

- Updated dependencies [01c2ed0]
- Updated dependencies [fa21188]
  - @mmnto/totem@1.96.0

## 1.95.0

### Minor Changes

- 4fb5ec0: feat(cli): single-sourced self-description drift-repair + default-help command tiering (mmnto-ai/totem#2336 slice B; partially addresses mmnto-ai/totem#1722).

  **Self-description re-sourced (D1).** The program `.description()` and the `@mmnto/cli` package.json `description` field are re-cut off the retired "persistent memory and context layer" category onto the Prop 294 D1 headline — "Totem — a local-first, file-anchored substrate that makes AI-agent work queryable, enforceable, and derivable in your codebase" — minted as one exported constant (`src/description.ts`) that both entrypoints and package.json consume. A deterministic parity test pins package.json === the constant and asserts the help header renders it, so the surfaces cannot drift. GitHub "About" is out of code reach and remains a manual parity surface.

  **Default help tiered to a consumer surface (D2).** Default `totem --help` / `totem help` previously flooded the operator with the full top-level command set (the ADR-094 "operator memory cliff"). It now renders exactly one declared consumer tier — `init`, `lint`, `lesson add`, `lesson compile`, `doctor`, `search`, `status` — plus a pointer line ("Run `totem help --all` for the full command surface."). A new tiered `help [command...] --all` command (replacing commander's built-in help command) lists EVERY command, split into Consumer and Advanced sections; `totem help <command>` still delegates to per-command help. The tier is a single exported data surface (`CONSUMER_TIER` in `src/help.ts`), never scattered per-command flags. Hiding is an information surface, never a gate (Tenet 12/13): every advanced command stays 100% functional and one `--all` away, and continuity primitives (`handoff`/`orient`) stay visibly present in the advanced listing.

  **Freeze-aware `lesson compile` badge (D2.4).** The `lesson compile` help line carries mechanism-only copy ("Compile lesson files into deterministic lint rules") and, when a rule-compilation freeze is VISIBLE in the current repo, a render-time `[frozen]` badge derived from the canonical freeze primitive (`readEffectiveFreezes` + `RULE_COMPILATION_FREEZE_ID`, matching the verify-manifest gate). Derived, never hardcoded (Tenet 20): a consumer with no freeze.json and no doctrine pin sees plain help. The Lite binary renders plain help with no freeze read.

  Consumer-impact: CLI surface — default `totem --help` output narrows from the full top-level command set to a seven-command consumer tier plus a `totem help --all` pointer; the full surface is unchanged behind `--all` and every command remains fully functional (the tier is display-only, not a gate). The CLI self-description (`.description()` and package.json `description`) is re-sourced onto the new positioning line. `lesson compile` help copy is mechanism-only and gains a repo-local `[frozen]` badge when a rule-compilation freeze is visible. No obligated consumer move — scripts should invoke commands directly rather than scraping `--help`; agents discover the full surface via the pointer to `--all`.

### Patch Changes

- Updated dependencies [6e6a9b1]
- Updated dependencies [0cc4c7f]
  - @mmnto/totem@1.95.0

## 1.94.0

### Minor Changes

- 99c72f3: feat(mail): `totem mail` gains an outbox roster-validation sensor (mmnto-ai/totem#2335; write-side sibling of the #2311 basename-collision sensor).

  **What it detects.** A dispatch whose frontmatter `to:` resolves to no roster agent is invisible to every seat-scoped poll — it "looks sent forever" and is never discoverable as unread (live exhibit: a verdict deposited with `to: cohort`, a non-roster literal). During its existing workspace scan `pollMail` now checks each parsed dispatch's `to:` against the roster and emits one structured `unresolvable outbox address:` warning per stranded file, naming the `repo/agent/file` path and the offending address, into the existing `warnings` array. The roster reuses the send-side actuator's `knownCohortAgents` set (the hardcoded-map audit is mmnto-ai/totem#2017) UNIONed with the polling repo's resolved self agents, so an env/config self-id outside the cohort map is never false-flagged. The no-`to:` / non-ADR-098 mail-shaped reject is the same undeliverable class but is already surfaced loudly by the existing `no to: field in frontmatter` parse warning, so the sensor does not double-warn it; non-mail-shaped strays stay silent per the #2118 unclearable-noise invariant.

  **Sensor, not actuator (Tenet 13).** Warn-only: unread counting is untouched and nothing is renamed, moved, or deleted. The check runs before the self-filter because an unresolvable address is undeliverable to every seat, not just the poller. As with #2311, because `totem ecl-gc --compact` arms its A2.2 completeness gate on `poll.warnings.length === 0` (mmnto-ai/totem#2309) and its discovery poll reads through marks (`includeProcessed`), a live unresolvable dispatch also holds mark-compaction shut with zero new gate surface.

  Consumer-impact: CLI surface — additive `totem mail` sensor output only. `pollMail` emits new `unresolvable outbox address:` lines on the existing `warnings` channel (text output and `--json`); no `MailPollResult` shape change and no change to `mail`/`scanned` counting semantics. No obligated consumer move — a workspace with only roster-valid `to:` addresses sees byte-identical output; scripts parsing warnings should treat the new class like any other warning line.

### Patch Changes

- @mmnto/totem@1.94.0

## 1.93.0

### Minor Changes

- bb556cd: feat(review): Prop 304 R2 local review runner (#2106) — opt-in multi-lane review fan via `review.lanes`, Prop 302 verdict artifacts under `.totem/artifacts/verdicts/` (lane-blind, content-addressed, `reviewedState`-honest), fix-delta round chaining with CLI-owned settle/cache predicates and composite scope-selector lineage keys, the `review-loop` distributed skill, the pre-fan/post-fan reviewed-content-hash authorization race fix, and presence-only `skipped-not-gated: true` on qualifying parity-readout rows (spec delta 4, totem-strategy#851).

  Consumer-impact: CLI surface — new `review.lanes` config key, `--continues` flag, and `local-lane:` summary line on the fan path; new `review-loop` distributed skill via totem init; new `.totem/artifacts/verdicts/` artifact class; `doctor --parity --json` rows gain `skipped-not-gated`. Single-lane `totem review` behavior is unchanged when `review.lanes` is absent.

### Patch Changes

- Updated dependencies [bb556cd]
  - @mmnto/totem@1.93.0

## 1.92.0

### Minor Changes

- 2b14228: `totem mail` gains a cross-sender basename-collision sensor (mmnto-ai/totem#2311; read-side half of mmnto-ai/totem-strategy#827).

  **What it detects.** ECL dispatch filenames don't encode the sender and `processed/` dedupe is basename-only — so when two distinct seats converge on one addressed-inbound basename in a single poll, a single mark would silently shadow BOTH dispatches (the second never surfaces as unread). `pollMail` now emits one structured warning per colliding basename, naming every `repo/agent` sender path, into the existing `warnings` array.

  **Composition, not plumbing.** Because `totem ecl-gc --compact` arms its A2.2 completeness gate on `poll.warnings.length === 0` (mmnto-ai/totem#2309) and its discovery poll reads through marks (`includeProcessed`, A2.1), a live collision automatically blocks mark-compaction during exactly the coexistence window in which compaction could strand a dispatch — zero new gate surface.

  **Sensor, not actuator (Tenet 13).** Warn-only: both dispatches still surface as unread mail; nothing is renamed, moved, or deleted. Sender identity keys on the outbox-owner seat (filesystem truth under single-writer discipline), never the forgeable `from:` header — one seat's broadcast fan-out copies across repos never fire it. No `MailPollResult` shape change; JSON consumers see the new message in the existing `warnings` field. Encoding `<sender>` into the filename convention remains the escalation path on mmnto-ai/totem-strategy#827 if this sensor ever fires on a real drop.

- 70224e5: feat(doctor): `--parity` trust-readout — verdict rollup (per-seat + global), run-time coverage denominator (mechanical / attestation-only / honest-absent), why-not per non-PASS row at the senses level probed, `--json` verdict artifact, and the `--strict` declaredly-toothless honesty line (Prop 303 §5(a) spec-to-build, mmnto-ai/totem#2327).

  Consumer-impact: CLI surface — `totem doctor` gains a `--json` flag (valid only with `--parity`; `doctor --json` without it now errors explicitly instead of silently ignoring the flag), and `doctor --parity` output gains the trust-readout tail after the per-row lines. Exit-code semantics are unchanged (`--strict` still exits non-zero iff a blocking contract drifted). Scripts that parse `doctor --parity` stdout/stderr line-by-line should anchor on the per-row `[Parity]` lines, which are byte-compatible; the readout is additive.

### Patch Changes

- @mmnto/totem@1.92.0

## 1.91.0

### Minor Changes

- 0d9b778: Resolve the `totem ecl-gc --compact` A2.2 completeness roster from consumer config, and **retire the interim `cohortRepos()` core export** (mmnto-ai/totem#2310; contract ADR-106 § A2.2 + `ecl-discipline` § 4.5; roster ruling by strategy-claude on the issue).

  **New config surface — `ecl.cohortRepos`.** `TotemConfigSchema` gains an optional `ecl` sub-schema (`EclConfigSchema`) whose `cohortRepos: string[]` declares the cohort repos whose ECL outboxes a "provably-complete" poll must scan before a processed-mark may be collected. Values are bare workspace **directory** names (e.g. `totem`, `totem-strategy`), matched against the workspace root's siblings — not `owner/repo` slugs. This is **consumer-declared** config, not a baked product identity: `totem ecl-gc` ships, so an external consumer's cohort is THEIR repos (Tenet 16). Change-authority for our cohort's value stays mmnto-ai/totem-strategy#611.

  **Precedence** (mmnto-ai/totem#2310): an explicit `EclCompactOptions.expectedRepos` (programmatic callers / tests) wins over `config.ecl.cohortRepos`; when both are absent the roster is **undeclared** and compaction hard-aborts (`gateComplete=false`, exit 3, **not** `--force-incomplete`-waivable) — unchanged from the shipped no-roster arm. The CLI action reads config at the process boundary (`loadEclConfig`) and injects it, keeping `eclCompact` a pure, synchronously-testable function.

  **Empty array is a loud config error, not "undeclared."** `cohortRepos: []` violates Zod `.min(1)` and fails at config load; the ecl-gc path surfaces it loudly (exit 2) and never degrades a config bug into the undeclared gate-red arm (the config read narrows its swallow to `CONFIG_MISSING` only). A genuine single-repo consumer declares a roster of one (completeness-1).

  **BREAKING for the one-release-old interim export.** `@mmnto/totem` no longer exports `cohortRepos()`. It shipped in 1.90.0 explicitly marked **INTERIM / product-locked / do-not-depend** with config-ification tracked in this issue, so its removal is expected — but consumers on 1.90.0 that imported it must switch to the `ecl.cohortRepos` config surface (or pass `expectedRepos` programmatically). No other public surface changes; prune behavior (`totem ecl-gc` without `--compact`) is untouched.

### Patch Changes

- a4641d7: Fix `totem mail` rendering a false-clean inbox from a subdirectory, and stop it certifying an empty inbox it cannot derive (mmnto-ai/totem#2312; Tenet 4 fail-loud). Two halves:
  - **Subdirectory workspace derivation.** Run from a SUBDIRECTORY of a repo (e.g. `.totem/orchestration/<seat>/processed/`), `pollMail` used `path.resolve(process.cwd())` as the repo root and `path.dirname(repoRoot)` as the workspace — both garbage from a subdir, so the outbox scan found nothing and the poll reported a clean inbox at exit 0. It now walks UP from the start dir to the nearest ancestor carrying a `.totem/` marker OR a `.git` entry (dir OR file — linked worktrees use a `.git` file), then derives the workspace as that root's parent. `@mmnto/totem` gains `findTotemRepoRootSync(start)` (pure fs, no git spawn), the sibling of `findRepoRootSync`, plus `resolveTotemRepoRootSync(repoRoot, cwd)` — the single home for the walk-start-not-definitive-root contract shared by `pollMail` / `eclGc` / `eclCompact`. A marker-less start dir falls back to the given dir (bare-fixture behavior preserved); explicit `--workspace` / `TOTEM_WORKSPACE` overrides are untouched. `totem ecl-gc` (`eclGc` prune + `eclCompact`) shared the same cwd-fragile seam and now walks up through the same helper.
  - **NOT-DERIVED verdict on unresolved self, with a new exit contract.** When no self agent resolves (`selfAgents.source: 'none'`), an empty inbox asserts nothing — every directed dispatch is filtered out, and even a surviving broadcast match cannot certify directed-mail absence. The text output now renders `Inbox state NOT DERIVED — no self agent resolved; …` instead of the clean-inbox (or unread-list) verdict, keeping the Workspace / Self agents / warning lines.

    **NEW EXIT CONTRACT:** `totem mail` now exits **2** when no self agent resolves (was: exit **0** with a clean-looking verdict), mirroring its `totem ecl-gc` sibling's unresolvable-self class — the plain poll must not be softer. A genuine clean inbox with a RESOLVED self stays exit 0. `--json` still emits the full result to stdout on the unresolved arm (it already exposes `source: 'none'` + warnings) AND exits 2. `pollMail` keeps its never-throws contract and return shape; the CLI wrapper maps the data to the exit code.

- Updated dependencies [0d9b778]
- Updated dependencies [a4641d7]
  - @mmnto/totem@1.91.0

## 1.90.0

### Minor Changes

- cad2f30: Add `totem ecl-gc --compact` — cursor-coupled processed-mark compaction, the read-side sibling of the outbox prune (mmnto-ai/totem#2307; parent mmnto-ai/totem-strategy#700; contract ADR-106 § A2 + `ecl-discipline` § 4.5, ratified strategy#826).

  Compaction deletes an agent's OWN `processed/` marks that shadow nothing — a mark whose inbound dispatch its sender already swept per § 4.4. The retained cursor is `processed ∩ raw-addressed-inbound`, where the raw set is the **pre-dedupe** discovery (a new `includeProcessed` option on `pollMail`), never `pollMail`'s `inbound − processed` list — feeding that back would delete every retained mark (the § A2.1 false-unread bomb). Deletion is licensed ONLY against a **provably-complete** poll (§ A2.2: full expected cohort roster present, zero scan warnings, not truncated — else zero deletes, uncertain ⇒ retain), binds to **exactly one seat** (§ A2.3), and **self-verifies** via an immediate re-poll (§ A2.4).

  Per the contract-owner roster ruling (strategy-claude), the completeness gate's declared roster is a **consumer-config-declared** expectation, not a core constant — `totem ecl-gc` ships, so a hardcoded cohort roster is a Tenet-16 product-vs-cohort lock. `@mmnto/totem` gains `cohortRepos()` as the **explicitly-marked interim** value (the strategy#611 frozen active set; authority stays strategy#611; config-ify tracked in #2310). The **safety corollary** (codified strategy#828 / eb9ff5b): an undeclared (empty) roster makes compaction **hard-abort** — fail-loud, non-zero exit, never a silent no-op and never "assume complete." An operator `--force-incomplete` escape waives only the roster-presence arm (scan warnings / truncation still abort; an undeclared roster still hard-aborts).

  Runs after the prune inside `/signoff` (`totem ecl-gc --apply --compact`). Combined exit contract: `0` clean · `1` partial janitorial delete failure (prune or compact) · `2` usage/agent-unresolvable · `3` compaction abort (A2.2 gate red — a DECLARED roster incomplete OR no roster declared at all — or A2.4 falsifier tripped) — `3` outranks `1`. Prune behavior (`totem ecl-gc` with no `--compact`) is unchanged.

- c66256d: Add `totem ecl-gc` — the binary-guaranteed, cohort-wide replacement for the interim `scripts/prune-outbox.mjs` (mmnto-ai/totem#2279; parent mmnto-ai/totem-strategy#700; doctrine/ecl-discipline.md § 4.4). It prunes the calling agent's OWN aged ECL outbox dispatches: `totem ecl-gc` self-resolves the single self-agent (reusing `resolveSelfSender`'s explicit > unambiguous-self > throw precedence) and prunes only `<repoRoot>/.totem/orchestration/<agent>/outbox/`, so a self-resolving binary structurally cannot prune a peer, `journal/`, or `processed/`.

  Dry-run by default (lists would-prune, deletes nothing); `--apply` deletes. Flags: `--retain-days <n>` (default 14), `--agent-id <id>` (visiting/orchestrator override), `--json` (structured stdout). Only `.md` dispatches with a parseable dual-form stamp (`YYYY-MM-DDTHHMMZ` or `…HHMMSSZ`) are eligible; the exact retention boundary is retained; non-file / non-`.md` / unparseable entries are surfaced and never deleted. Exit codes: 0 clean, 1 partial delete failure (janitorial sensor, non-blocking — Tenet 13), 2 usage error. The distributed `signoff` skill gains a prune step (step 5) wiring `totem ecl-gc --apply` into end-of-session cleanup. This train ships prune only; processed-mark compaction is a deferred follow-on, and `scripts/prune-outbox.mjs` is intentionally left in place.

### Patch Changes

- Updated dependencies [cad2f30]
- Updated dependencies [2530a3b]
  - @mmnto/totem@1.90.0

## 1.89.0

### Minor Changes

- 9721866: feat(spine): ADR-112 §5.1/§5.4/§8 R1 — the tamper-evident freeze-orchestration (real-set slice 1, Option A mechanism-first). New `totem spine freeze-split`: derives the real split from lc HEAD at freeze time (Q3 derived-at-freeze — `asOfCommit` pinned from the actual clone HEAD), stamps `frozenAt` (the freeze is the one legitimate clock in the authored lane), and writes the tracked-public `frozen-split.json` with a content-addressed `splitRef` (`split:<sha256(canonical payload)>`, commitment and label excluded from the preimage) and a `freezeCommitment = sha256(splitRef · frozenAt · corpusIntegrity)`. Tamper-evidence is (a)+(b) composed: (a) commit-anchored — the shared-history proof is TOPOLOGY-first (the anchor is the first `origin/main` commit carrying the artifact's exact content; ledger entries must descend from it strictly by ancestry; the `frozenAt ≤ committerDate` comparison is a consistency check with its own diagnostic, never the proof — `GIT_COMMITTER_DATE` is settable, ancestry rewrites are observable); (b) hash-commitment — every authoring-ledger entry authored under a frozen artifact chains `freezeCommitment` INSIDE its `authoringContentHash` material, so a re-freeze flips every downstream entry to would-revise (orphaned loudly, never silently current). `totem rule author` gains the binding: a content-addressed `splitRef` in `authored-rules.yaml` engages artifact resolution + the shared-history proof before intake, requires a matching header `freezeCommitment`, and mechanically enforces §5.2 train-side fixtures at author time (compose-never-replace with the materialize gates). §5.4 author sandbox: a derived lc worktree at the frozen artifact's `cutBoundarySha` with a fail-loud read guard — root and config derive from the artifact alone (no author-owned knobs; the judgedBy≠author independence axiom applied to config). Authored seeds may now bind their freeze via `split.frozenSplitRef` (exactly-one-of with the legacy `split.frozenAt`); a frozen-artifact materialize loads the artifact as the single source, re-derives the split from the pinned inputs ONLY to assert byte-equality (detect-never-repair), verifies the per-entry commitment chain + ancestry ordering, and writes `split.json` as the byte-identical copy of the frozen split. Mined paths and legacy-shaped authored fixtures are byte-unaffected throughout. The freeze-proof failure partition is 11+ distinct non-aliasing fail-loud rows (uncommitted ≠ tracked-but-not-shared ≠ blob-differs, etc.). No new surface consults `@mmnto/strategy-doctrine` (#2289 must-not-widen).
- 5996407: Promote `/signon` to a distributed Claude Code skill (mmnto-ai/totem-strategy#536, Proposal 295 d2). `totem init` now installs `.claude/skills/signon/SKILL.md` — the session-start read-twin of `/signoff` (consume/derive orientation, poll mail since last signoff, re-derive carryforward gates, present next-steps for operator ruling) — via the same mmnto-ai/totem#1890 marker-based distribution as `signoff` and `review-reply`. Two pilot amendments are folded into the canonical content before freeze: the frozen cohort-shorthand→repo-slug roster (`totem` / `strategy` / `status` / `lc`, mmnto-ai/totem-strategy#611) for cross-repo gate re-derivation, and a mail-poll cutoff that derives from the newest journal's content date (filename stamp / frontmatter), never file mtime (mmnto-ai/totem-strategy#813 — mtime lies on fresh clones/worktrees and silently reports "inbox clean" over waiting mail). `totem eject` now derives its scrub list from the canonical `DISTRIBUTED_CLAUDE_SKILLS` so a newly distributed skill can never orphan on eject.

### Patch Changes

- 111e53e: ADR-112 authored exercised/non-vacuity semantics — option (i) (operator ruling 2026-07-04, #2291): on the authored path, `positiveControlsExercised` is the §6 emission channel (`|authoredControls.positive|` — the §4 preimage-differential at emission IS the exercise proof), and the per-rule C1 positive-control verdict is differential-held-at-emission (`computeAuthoredPerRuleControlResults`, threaded from the §8 resolver through `ScoredRun` into persist) — never fire-on-window-diff, which is structurally unsatisfiable for strictly pre-window anchors (§5.2). Fixes the pre-existing authored-path double-fault: the mined-channel exercised count was structurally 0 (floor ⇒ permanent HONEST-NEGATIVE) and the projected targets could never fire (⇒ vacuous-positive FAIL). The mined lane is byte-unchanged; `verdict.nonVacuity` reads vacuously true on authored verdicts (the authored vacuity guards are the non-emission gate + the exercised floor).
- 0b876d4: ADR-112 §5.2 fixture-gate widening to leakage semantics (the #2294-couple ruling, operator option (a) recorded on strategy#810): a `positiveFixtures.pr` is legal iff `∉ heldOutPrs` AND (`∈ trainPrs` OR strictly pre-window by ANCESTRY — `is-ancestor(mergeCommit(pr), cutBoundarySha)`, never PR-number order). Widened at all three homes — the intake gate (`runRuleAuthor`), the pure freeze gate (`checkPositiveFixturesTrainSide` / `assertAuthoredFreezePreconditions`, signature gains the verified set), and the §6 deriver (`deriveAuthoredControls`) — with the ancestry proof derived only at git-holding command boundaries (`verifyPreWindowFixturePrs`) and handed in as data; held-out membership is never overridable by the verified set. The authored materializer also resolves proven pre-window fixture diffs into the control dirs. An empty/absent verified set reproduces the prior strict behavior byte-for-byte (legacy lane unchanged). Unblocks the cert-1 anchor set (all anchors ≤ lc#422, strictly pre-window).
- 14b4431: `totem rule author`: the ADR-112 §5.4 author sandbox is now fail-loud NON-OPTIONAL when the authoring header names a frozen split artifact — omitting `--lc-dir` under a content-addressed `splitRef` throws `GATE_INVALID` at binding-engagement instead of silently skipping the sandbox reachability proof (the independence axiom forbids an author-owned knob whose omission disables the guard; found by the #2294 couple verification). The legacy free-text `splitRef` lane binds nothing and is byte-unaffected.
- Updated dependencies [317b1a9]
- Updated dependencies [5a310ec]
- Updated dependencies [0ee6028]
- Updated dependencies [9721866]
- Updated dependencies [bb9d221]
- Updated dependencies [111e53e]
- Updated dependencies [0b876d4]
  - @mmnto/totem@1.89.0

## 1.88.0

### Patch Changes

- Updated dependencies [3a6048d]
  - @mmnto/totem@1.88.0

## 1.87.0

### Minor Changes

- 648a987: ADR-112 §6/§5.3 Slice D2.6 — window-wide answer-key deriver for the AUTHORED producer.

  Under `producerKind:'authored'`, the cert-run answer key (`ground-truth-labels.json`) must be derived WINDOW-WIDE (train ∪ held-out non-control), not held-out-only. Authored positive controls are train-side, so a held-out-only key leaves their corpus firings unlabeled → `needsAdjudication` → a run that can never PASS (permanent HONEST-NEGATIVE; totem-agy's D2 mechanical proof). This is the §6 follow-on split out of D2.5.
  - **`corpusWindowPrs(split)`** (`@mmnto/cli`, `spine-fetch-dispositions`): pure sibling of `corpusHeldOutPrs` = `(trainPrs ∪ heldOutPrs)` minus the positive/negative controls, deduped + ascending. `fetch-dispositions` branches on `producerKind` (authored → window-wide dispositions; mined → held-out-only, byte-unchanged) with a scope-aware empty-check message + log.
  - **`assembleAuthoredCertifyingCorpus(opts, lock)`** (`@mmnto/cli`, `spine-cert-run-corpus`): the derive-path sibling of `assembleCertifyingCorpus`. Loads the authored substrate with ground-truth SKIPPED (the deriver PRODUCES the key — circularity guard) while still hash-binding the scoring source (`prDiffsSha`), then builds via the existing `buildAuthoredCertifyingCorpus` (which owns the §8 ledger-sourced `judgedBy`). `loadAuthoredCertRunFixtures` gains an additive `skipGroundTruth` param (parity with the mined `loadCertRunFixtures`).
  - **`derive-labels`** (`@mmnto/cli`): producerKind-aware — an authored lock assembles via the authored sibling (window-wide firings over the authored substrate); a mined lock is byte-unchanged. Adds an injectable `totemDir` (defaults to the `.totem/spine/gate-1` convention).

  The RUN-path §8 single-home dispatch (`resolveCertifyingCorpusProvider`) is UNTOUCHED — the producer commands (`fetch-dispositions` / `derive-labels`) read `producerKind` at the command layer, mirroring how the mined deriver already bypasses the resolver (gemini single-home ruling holds; strategy 2026-07-01 additive-sibling ruling, no §8 re-decision owed). Contract settled in ADR-112 §6/§5.3 — no new core ruling. Still INERT until D3; no production authored lock exists. closingRefs [].

### Patch Changes

- Updated dependencies [648a987]
  - @mmnto/totem@1.87.0

## 1.86.0

### Minor Changes

- d53fb80: ADR-112 §8 Slice D2.5 — read-only / no-mint precondition on the authored cert-corpus producer (strategy ruling 2026-06-30, Q1–Q4).

  `buildAuthoredCertifyingCorpus` re-derives the authored records via `runRuleAuthor` (the writer) during cert-corpus assembly. D2's step-0 gate checks only that the authoring-ledger is NON-EMPTY — not that no rule is minted/revised — so a cert run over a stale `authored-rules.yaml` (a new or edited rule) would mint/revise it and certify its own mint (the CodeRabbit Major on #2274, deferred from D2). A cert run is NOT the first author.
  - **`runRuleAuthor` gains a `verifyOnly` mode** (`@mmnto/cli`): a cert-run re-derive runs Pass 1 (pure eligibility/identity/contentHash) and fails loud (`GATE_INVALID`, naming the rule(s) + `minted`/`revised`) BEFORE Pass 2's first ledger append if any current rule would be `minted` or `revised` — only `unchanged` passes (revise is forbidden identically to mint). Zero ledger writes on the throw (Tenet-4 no-drift). It is the read-side sibling of D2's §8 source-flip: the cert-run re-read writes nothing and asserts all-unchanged (Tenet-13 sensor-not-actuator).
  - **`buildAuthoredCertifyingCorpus` always calls `verifyOnly: true`** (`@mmnto/cli`) — the cert path is read-only against the authoring-ledger; the authoring path (`totem rule author`) is unchanged and still mints/revises (cert-path-only scope).
  - Composes with — does not replace — the producer's step-0 empty-ledger and step-3 judgedBy/split gates (layered: empty → no-mint stale → verdict/binding divergence).

  Couples strategy's ADR-112 §8 no-mint-precondition amendment (couple-on-merge, the #789⊕#2274 pattern). Still INERT until D3 (scoring ignores `authoredControls`); no production authored lock exists. The §6 window-wide answer-key deriver is a separate follow-on slice (D2.6). closingRefs [].

### Patch Changes

- Updated dependencies [d53fb80]
  - @mmnto/totem@1.86.0

## 1.85.0

### Minor Changes

- ea5ae63: ADR-112 §5/§6/§8 Slice D2 — wire the authored cert-run INPUT path: a lock-level `authored: { expectedSplitRef }` block (additive-optional, `.strict()`, reject-unless-authored), an authored fixture-substrate loader (`loadAuthoredCertRunFixtures`, sharing the gate-critical SHA-integrity via the extracted `readAndVerifyScoringSubstrate`), and an async single-home resolver so the caller never branches on `producerKind`. `judgedBy` is the §8 single source in the authoring-ledger (derived at run time, NOT on the lock — strategy couple-on-D ruling (iii), no Tenet-20 mirror), with an assert-equal backstop; the cert run is author-first (the ledger must pre-exist). Mined path byte-unchanged. Inert/test-lock-only — a production authored run still needs the window-wide label deriver (D2.5, §6). strategy#591/#661.

### Patch Changes

- Updated dependencies [ea5ae63]
  - @mmnto/totem@1.85.0

## 1.84.0

### Minor Changes

- 6cafc31: ADR-112 §6/§8/§9 Slice D1 — wire the authored producer into the Gate-1 certifying corpus (inert-until-D3, strategy#591/#661).

  The authored producer (`runRuleAuthor` → `toCompileFeed` → `runCompileStage` → the inert `deriveAuthoredControls`) was fully built but unconnected to the cert corpus. D1 connects it via a SIBLING assembler + provider (not a branch in the mined path — the mined `buildCertifyingCorpus` stays byte-unchanged):
  - **`buildAuthoredCertifyingCorpus`** (new, `@mmnto/cli`) assembles an authored-provenance `CertifyingCorpus` from `.totem/spine/authored-rules.yaml`: `runRuleAuthor` (preserving the §3/§8 producer invariants — no ad-hoc records) → `rejected.length === 0` precondition → file/ledger **split-binding verification BEFORE compile** (every record's authoring-ledger `splitRef` must equal this run's split, with `authoredAfterSplit` + `heldOutNonInspectionAttestation` — the §5 leakage guard `deriveAuthoredControls`'s train-side check alone cannot cover) → `toCompileFeed` → `runCompileStage` (**authored compile-rejection = hard failure**) → homogeneous-authored assembly from the `c.provenance` sidecar → `deriveAuthoredControls`. Every gap fails loud (Tenet-4).
  - **`buildAuthoredCorpusProvider`** + **`resolveCertifyingCorpusProvider`** (new, `@mmnto/cli`) — the single dispatch home: pick the mined replay provider vs the authored sibling off the lock's `producerKind` (absent ⇒ mined), so no `kind` branch is scattered downstream. The mined branch is byte-unchanged.
  - **`CertifyingCorpus.authoredControls?`** (new channel, `@mmnto/cli`) — the §6 emission lists, present iff the corpus is authored-provenance (defined-with-empty-arrays for an authored corpus with no emitting fixtures; `undefined` for mined).
  - **`deriveAuthoredControls`** (`@mmnto/totem`) now reads provenance from a required `provenanceByRule` sidecar map, never `rule.legitimacy` (absent at the assembly seam — stamped only post-scoring).
  - **`WindtunnelLock.producerKind`** (`@mmnto/totem`) — additive-optional `'mined' | 'authored'` dispatch signal; absent ⇒ mined, so every existing lock parses + serializes byte-unchanged.

  INERT: nothing in scoring/persist/report consumes `authoredControls` yet (the engine reads only rules/prDiffs/groundTruth/provenanceByRule) — D3 (`scoreAuthoredWindtunnel`) + D4 (Gate-2 eligibility/report) consume it. The authored cert-run INPUT wiring (lock-sourced `judgedBy` / `splitRef` + an authored fixture-substrate loader) lands in D2; until then the resolver fails loud if a lock declares `producerKind: 'authored'` without authored deps.

### Patch Changes

- Updated dependencies [6cafc31]
  - @mmnto/totem@1.84.0

## 1.83.0

### Patch Changes

- Updated dependencies [7baaad5]
  - @mmnto/totem@1.83.0

## 1.82.0

### Patch Changes

- Updated dependencies [902e7f3]
  - @mmnto/totem@1.82.0

## 1.81.1

### Patch Changes

- Updated dependencies [1e7881a]
  - @mmnto/totem@1.81.1

## 1.81.0

### Patch Changes

- Updated dependencies [c3cfeee]
  - @mmnto/totem@1.81.0

## 1.80.0

### Minor Changes

- 367c05e: feat(spine): ADR-112 Slice B — authored-rule producer surface (`totem rule author`)

  Adds the human-authoring front door for the Gate-1 authored-rule producer (strategy#591, ADR-112 §3/§8):
  - **`totem rule author`** ingests `.totem/spine/authored-rules.yaml` into authored rules + a fail-loud §8 authoring-ledger (`.totem/spine/authoring-ledger.ndjson`).
  - The reader re-runs the **independent** structural-eligibility check and **overwrites** any author-supplied verdict — the strict `AuthoredRuleInput` schema makes producer-owned fields (`structuralEligibility`/`decidable`/`ruleId`/`disposition`/…) inexpressible in the hand-editable YAML (FM(d) trust boundary).
  - Stable identity via **upsert on `(author, targetDefect)`** — idempotent re-reads (no duplicate ledger rows), a `dslSource` edit revises in place, a `targetDefect` edit re-identifies.
  - The fail-loud authoring-ledger is read-back-verified on every append (FM(e)); a non-decidable rule is surfaced loudly and excluded, never silently dropped.
  - The decidable-class whitelist ships **inert/pluggable** (mechanism only; the cert-#1 class set is delivered as data later).

  Inert producer: records + ledger are written but not yet consumed by the compiler or scorer (Slices B2/C/D). Mined behaviour is unchanged.

### Patch Changes

- 87512fd: feat(spine): ADR-112 §4 — preimage-differential source-pluggable (`preimageSource` union)

  Reframes the authored-rule fixture's preimage anchor from a fixed commit-pair to a per-fixture **`preimageSource` discriminated union** (strategy#591 / ADR-112 §4, coupling mmnto-ai/totem-strategy#767):
  - **`{ kind: 'lesson', lessonRef, badExample, goodExample }` (PRIMARY)** — for **review-caught** repos that fold the fix into the introducing commit, so the defect structurally almost never lands on `main` (lc: 18 `fix(` of 433). The positive control fires on the lesson `badExample` and stays silent on `goodExample`. `lessonRef` is bound to the immutable 16-hex `hashLesson` codomain (never a path or mutable alias — §8 identity discipline).
  - **`{ kind: 'commit', preimageCommitSha, mergeCommitSha }` (FALLBACK)** — the prior commit-pair binding, now scoped to **land-then-fix** repos.

  `AuthoredFixtureSchema` is the single home (auto-threads to `AuthoredProvenanceRecordSchema` + the YAML-input `AuthoredRuleInput`); the new `PreimageSourceSchema` / `PreimageSource` are exported. Built as `z.discriminatedUnion` with each branch `.strict()`, so a cross-branch key fails loud (FM(d)). The `totem rule author` YAML input contract changes accordingly (authors declare a `preimageSource` instead of flat commit fields); the recursive producer-key scan walks the new union depth.

  No data migration is owed — there is no persisted authored-rule set, and the flat schema was never released (it ships first in this same union'd version). The §4 preimage-differential itself (fire-on-preimage / silent-on-postimage) materializes in Slices C/D; this slice is the schema + producer + tests.

- Updated dependencies [87512fd]
- Updated dependencies [367c05e]
  - @mmnto/totem@1.80.0

## 1.79.0

### Patch Changes

- Updated dependencies [7ec2974]
  - @mmnto/totem@1.79.0

## 1.78.0

### Minor Changes

- d0236ef: feat(parity): strategy-doctrine lock-content detector (totem#2107, strategy#754)

  Adds `detectLockContentContract` (core) + the `manifestation: content-hash` route and `lockContentPackageDirFor` registry (CLI `doctor --parity`), closing the content half the `parity-manifest-currency` row's own TODO names — the currency row proves the `@mmnto/strategy-doctrine` pin is current; this row proves the distributed content matches. Re-derives each consumed lock `artifacts[].content-hash` via the §6 `normalize()`+`sha256()` contract (`normalizeLockArtifact`/`hashLockArtifact`, byte-for-byte the publisher's `tools/build-strategy-doctrine.cjs`), in two honest-absent layers, NEVER a fetch (Tenet 6/13): self-consistency (always — re-hash each packaged file vs its own lock hash) and vs-canonical (only when a local `../totem-strategy` sibling resolves via `resolveStrategyRoot` — re-hash the artifact's `canonical-source`). Layers render SEPARATELY (per artifact × per layer; no collapsed "content drift" verdict). `last-published-sha` is provenance-info only (a local `git cat-file -e` existence note when a sibling resolves), never a `sha == HEAD` comparator. Honest-absent taxonomy: package not installed → `skip`; lock absent/unparseable/unsupported-schema → `warn`; packaged-artifact absent / hash mismatch → self `warn`; sibling absent → vs-canonical `skip`. Adds the `content-hash` rung to the §6(a)2 ladder. The strategy-owned `strategy-doctrine-lock-content` manifest row (strategy#754) couples to this engine on merge.

### Patch Changes

- Updated dependencies [d0236ef]
  - @mmnto/totem@1.78.0

## 1.77.0

### Minor Changes

- 3a35a1a: feat(doctor): sense the pnpm-engine-version parity row — packageManager-field toolchain reader (#2115)

  Teaches the `version-pinned` detector a toolchain sub-class: a `toolchain-version` row that resolves no deps package (e.g. `pnpm-engine-version`) now reads the consumer's `packageManager` field (`pnpm@11.2.2+sha512…`) instead of a `dependencies` range. `detectVersionPinnedContract` self-routes those rows to a new `detectPackageManagerToolchain`; the CLI no longer stubs them as "drift detection not yet implemented".

  The floor comes from the row's own `expected-value-or-derivation` (`pnpm@<floor>` — there is no `packages/*/package.json` to glob, `canonical-source` is null). Reads the DECLARATION only (`senses: declared`), never probes the installed binary. Parses `<name>@<version>(+<hash>)?` tolerantly, compares `version >= floor`, and surfaces a note when the pin is hashless (corepack integrity not pinned — strategy#566). Honest-absent on a missing field, a different engine (the floor doesn't apply), an unparseable pin, or a non-derivable floor; never networks, never throws. A `toolchain-version` row that DOES resolve a deps package (`mmnto-cli-version`) stays on the existing deps floor path.

  Empirically: `totem doctor --parity` flips the `pnpm-engine-version` row from `SKIP` to `PASS — pnpm engine pin current — packageManager 11.2.2 ≥ cohort floor 11.2.2`.

### Patch Changes

- Updated dependencies [3a35a1a]
  - @mmnto/totem@1.77.0

## 1.76.1

### Patch Changes

- 96d5d55: fix(doctor): resolve the cohort floor for strategy-published parity rows + sharpen the optional-pin WARN hint (#2108, #2094)

  `resolveCohortFloor` (core `parity-detect.ts`) previously probed only totem-shaped floor sources — self-in-tree and the `../totem` sibling — so a _strategy_-published package like `@mmnto/strategy-doctrine` was honest-absent by construction and its `version-pinned` row verdicted `SKIP` instead of the consumer-side `pass`/`warn`. It now adds a canonical-source-repo probe: when the contract's `canonicalSource` names `totem-strategy`, the floor is resolved from that repo's `packages/*` by reusing `resolveStrategyRoot` (env / config / `../totem-strategy` sibling — still NEVER networks, never throws, honest-absent on miss). The honest-absent remediation also stops recommending `../totem` for a package totem doesn't publish (#2108).

  The `doctor --parity` configured-but-missing WARN hint now names the install-side cause when the configured manifest path lives under `node_modules/` (the strategy-doctrine optional-pin shape): the expected unauthed-CI state is "optional dep skipped at install (npm read-auth required)", not a misconfigured path (#2094).

- Updated dependencies [96d5d55]
  - @mmnto/totem@1.76.1

## 1.76.0

### Minor Changes

- 099d892: feat(parity): value-equality detector for bot-review-config rows (strategy#738 Slice A)

  Adds `detectValueEqualityContract` (core) + a `manifestation: value-equality` route and `valueEqualityFieldsFor` registry (CLI `doctor --parity`), promoting the `bot-review-configs` manifest rows from `attestation` to a present-level mechanical scalar check. Reads a scalar at a dotted path in the consumer's on-disk config (`.coderabbit.yaml` / `.gemini/config.yaml` / `greptile.json`) and compares it — typed (never blanket-stringified), zero-network — against the row's own `expected-value-or-derivation`. Honest-absent taxonomy: file-absent → `skip` (scaffold), path-absent/mismatch → `warn`, unparseable → `unknown`. Adds the `value-equality` rung to the §6(a)2 ladder. The strategy-owned manifest row flip couples to this engine on merge.

### Patch Changes

- Updated dependencies [099d892]
  - @mmnto/totem@1.76.0

## 1.75.2

### Patch Changes

- 3cba4d7: fix(triage-pr): surface greptile's Comments-Outside-Diff + confidence, and never under-report "Nothing to triage"

  `totem triage-pr` (and the shared bot-review extractor) now fetch the PR
  issue-comment surface via `gh api` — which preserves the `[bot]` login suffix
  and `user.type` that `gh pr view` strips — so a review bot's standing summary
  comment is recognized as bot material instead of silently dropped.

  Greptile's out-of-diff findings are extracted from its summary by the canonical
  `<!-- greptile_other_comments_section -->` marker (mmnto-ai/totem-strategy#690),
  not a sampled `<details>` shape: greptile edits its summary in place, so the
  findings are only present mid-review and the marker is the reliable anchor. The
  findings render via the existing bot-agnostic triage table. Greptile's documented
  Confidence Score (`N/5`) is surfaced as a triage context signal.

  The empty-state guard no longer prints a bare "Nothing to triage" when comments
  were fetched: when raw comments exist but none are bot-authored it reports the
  per-surface counts, and a bot summary being present (even if it parsed no
  discrete findings) always keeps the PR in triage. This makes the tool the
  mechanical enforcement of the "read every surface, in full" review-reply
  discipline (mmnto-ai/totem#2192).
  - @mmnto/totem@1.75.2

## 1.75.1

### Patch Changes

- 5289be6: fix(triage-pr): recognize `greptile-apps[bot]` across the bot-review pipeline (mmnto-ai/totem#2192)

  `totem triage-pr` silently dropped greptile findings. The shared bot-author classifier (`isBotComment` / `detectBot`) only matched `coderabbit` / `gemini-code-assist`, so `greptile-apps[bot]` inline comments fell through as non-bot and the command printed "No bot review comments found. Nothing to triage." even when greptile had posted actionable findings.
  - **Classifier**: `isBotComment` / `detectBot` now recognize greptile (substring match — a future `greptile-enterprise[bot]` is surfaced rather than dropped; the deliberate divergence from core `review-catch.ts`'s exact-match attribution scheme is documented inline).
  - **Severity**: new `parseGreptileSeverity` (P0/P1/P2/P3 → critical/high/medium/low) plus a single `parseSeverityForTool` dispatch that replaces the per-tool severity ternary previously triplicated across `triage-pr`, `recurrence-stats`, and `retrospect` — so adding the next bot is a one-place change. P0 is greptile's blocking level; without it a `P0` finding would silently bucket as `info`.
  - **First-class attribution**: greptile is added to the persisted core enums (`RecurrenceToolSchema`, `RetrospectFindingToolSchema`) and the shared `toSeverityBucket`, so it is attributed as its own tool in both `recurrence-stats` and `retrospect` output (not collapsed to `unknown`). Renders as `GT/<severity>` in triage output.
  - **Deferred** (noted on the issue): greptile review-body / issue-comment "Comments Outside Diff" surfacing, which needs a distinct greptile body-parser + a new fetch path.

  The widened `BotTool` union, `parseSeverityForTool`, and the core enum additions make greptile a peer of CR/GCA wherever the CLI ingests bot review comments.

- Updated dependencies [5289be6]
  - @mmnto/totem@1.75.1

## 1.75.0

### Minor Changes

- 03b9168: spine: extractor-yield β (bot-review substrate + chrome normalization) + γ (RESOLVED-eligibility) — strategy#709 yield-fix PR-2

  Builds on slice α (the NO-DRAFT cause-tags that made the moat measurable). Strategy ruled the first Gate-1 cert run's honest-negative is a pipeline input-hygiene + class-coverage loss, not a thesis failure — these two levers address the dominant extract→draft leak. Both move `extractorInputKey`, so the cert-#1 fixture invalidates by design (one clean re-record is the decisive cert re-run).

  **β — bot-review substrate + chrome normalization (panel OQ-β1..β4):**
  - **`reviewBotIdentity`** (core, `selection-rule.ts`): a NEW allowlist predicate recognizing review-FINDING bots (`gemini-code-assist` / `coderabbitai`, with/without a `[bot]` suffix), kept DELIBERATELY SEPARATE from `isBotIdentity` (which still gates `[bot]`-authored corpus membership, unchanged). Allowlist-not-denylist: a not-yet-listed tool undercounts rather than laundering every future automation account in.
  - **`substantiveCommentCount`** (replaces `humanCommentCount`): counts human + recognized review-bot comments as substrate; still excludes unrecognized `[bot]` noise (renovate/dependabot) + empty bodies. For this bot-reviewed cert corpus, gemini/CR review comments ARE legitimate substrate.
  - **`normalizeReviewChrome`** (core, new `review-normalize.ts`): a deterministic, idempotent, audit-preserving strip of bot-review chrome (severity badges, `<details>` collapsibles, HTML comments) — raw `body` kept, `normalizedBody` added. The extractor prompt renders it and `extractorInputKey` digests it; `REVIEW_CHROME_NORMALIZER_VERSION` folds into the replay provenance, so a normalizer change re-keys (replay miss) AND flips the integrity hash → re-record forced (Tenet-15).
  - **`authorKind` + source-tag**: each `ReviewThreadComment` carries `authorKind`; each draft carries a `DraftSourceKind` (`human|bot|mixed`) computed from its eligible threads, serialized onto the §8 emission ledger (NOT the reused `ProvenanceRecord`) + the zero-draft drop — a non-FM Tenet-19 diagnostic that makes the bot-substrate share observable.

  **γ — RESOLVED unconditional (strategy class-coverage lever):**
  - **`eligibleThreads`** narrows from `!isResolved && !isOutdated` to `!isOutdated`: a RESOLVED thread is the highest-signal legitimacy marker (a defect a reviewer raised AND the author confirmed by fixing), so it is now ADMITTED; only OUTDATED (diff-hunk-stale) threads stay excluded. The core gate and the replay-key eligibility move in LOCKSTEP.
  - Drop-reason hygiene: `resolved-rejected` → `outdated-rejected` (the gate now drops only on outdated), and the zero-draft drop gets its own `no-draft` reason code (slice α had mislabeled a legitimate model decline as `unparseable`; `noDraftCause` carries the precise sub-reason).

  No FM falsifier is touched — `authorKind` / `sourceKind` / `noDraftCause` are all diagnostics, and the eligibility narrowing is a curation property. Test-first / mock-driven, zero live LLM in CI.

### Patch Changes

- Updated dependencies [03b9168]
  - @mmnto/totem@1.75.0

## 1.74.0

### Patch Changes

- Updated dependencies [123fb52]
  - @mmnto/totem@1.74.0

## 1.73.2

### Patch Changes

- 2de32ab: spine: cert-run papercuts (#2237) — record `loadEnv`, freeze auto-seals `llmReplaySha`, persist firing detail on FAIL

  Three fix-forwards the first end-to-end Gate-1 cert run (strategy#709) surfaced — each a gap that only showed up because the pipeline had never run live before:
  - **`spine windtunnel record` now `loadEnv(cwd)`** before resolving the provider credential, so an `.env`-only `ANTHROPIC_API_KEY` is visible. The spine commands (unlike ~18 others) did not load `.env`, so `record` fail-closed as "no credential resolved" until the key was exported by hand.
  - **`freeze` now auto-SEALS `controls.integrity.llmReplaySha`** from the frozen `llm-replay.v1.json` — the two-phase lock's documented sealer (materialize omits it, record produces it, freeze seals it). It computes the same `computeArtifactHash` the run re-verifies, so the operator no longer hand-edits the lock. Absent fixture on a certifying lock warns (mirroring `prDiffsSha`/`groundTruthSha`).
  - **The certifying-run report now persists per-firing detail** (rule, pr, file, matched-line) REGARDLESS of verdict. Previously a FAIL / honest-negative run kept only the `needsAdjudication` labelId hashes, so the firings were not observable for blind-by-pattern adjudication.
  - @mmnto/totem@1.73.2

## 1.73.1

### Patch Changes

- b07347e: spine: enforce `groundTruthSha` at the certifying run + freeze (#709 5d-iii-ii)

  The Gate-1 answer key (`ground-truth-labels.json`) is now integrity-gated end-to-end. `derive-labels` (5d-iii-i) already stamps `controls.integrity.groundTruthSha`; this wires the run-side enforcement: `loadCertRunFixtures` verify-then-parses the answer key on a single read (the certifying run hard-fails on a missing or tampered digest), and `freeze` surfaces a warn-only heads-up (mismatch / declared-but-missing / absent-on-certifying), mirroring the `prDiffsSha` scoring-source gate. The deriver is unaffected — it produces the file (`skipGroundTruth`) and is exempt from the run-path precondition. With this, the certifying run reads the materialized frozen labels (it does not re-derive them) against a verifiable answer key, so the cert run is runnable end-to-end.
  - @mmnto/totem@1.73.1

## 1.73.0

### Patch Changes

- Updated dependencies [5bed0e6]
  - @mmnto/totem@1.73.0

## 1.72.1

### Patch Changes

- Updated dependencies [df84386]
  - @mmnto/totem@1.72.1

## 1.72.0

### Patch Changes

- Updated dependencies [facc2fa]
  - @mmnto/totem@1.72.0

## 1.71.1

### Patch Changes

- Updated dependencies [ba288bc]
  - @mmnto/totem@1.71.1

## 1.71.0

### Patch Changes

- Updated dependencies [bd774bd]
  - @mmnto/totem@1.71.0

## 1.70.1

### Patch Changes

- Updated dependencies [e15da1b]
  - @mmnto/totem@1.70.1

## 1.70.0

### Minor Changes

- 5ed9ea9: Gate-1 miner slice 5b-ii (ADR-111): the LIVE LLM adapters that complete the
  record/replay scaffold from 5b-i. Adds `LiveDraftExtractor` / `LiveDraftClassifier`
  (structural implementations of the core `DraftExtractor` / `DraftClassifier` ports
  that drive an injected, provider-routed `InvokeOrchestrator` seam — never
  `runOrchestrator`, so no response cache can replay a stale answer as a fresh live
  call), the frozen miner extract/classify prompts, and the fail-loud guards: a
  construction-time `verifyLlmAdapterConfig` plus an end-of-run `assertPipelineProductive`
  floor (`all-items-failed ⟹ throw`, so a dead provider can't masquerade as
  structural-signal sparsity), a closed-set classifier parse (`classified` only for a
  single unambiguous label, else the low-privilege `{behavioral, error-default}`
  safe-default), an `assertLiveLlmAllowed` CI guard, and a `buildReplayProvenance`
  helper that binds the prompt/provider provenance the 5b-i integrity gate covers (a
  prompt edit forces a re-record). Per-item failures stay fail-soft (`[]` / safe-default,
  never throw). STUB-seam-tested — NO live LLM, NO network in CI; the live wiring +
  record run land in slice 5c.

### Patch Changes

- @mmnto/totem@1.70.0

## 1.69.0

### Minor Changes

- 5ced63b: Gate-1 miner slice 5b-i (ADR-111): deterministic LLM record/replay SCAFFOLD for the certifying run (consolidated fold A central answer + fold B integrity gate). Adds the CLI-side `llm-replay.v1` Zod artifact (two typed record sections — `records.extractor: inputKey → string[]`, `records.classifier: inputKey → ClassifierResult` — plus a run-level provenance block), the `deriveClaimId`-pattern `extractorInputKey`/`classifierInputKey` digests (identity-fields-only, `mergeCommitSha`-bearing, normalized so thread/comment order can't re-key; `draftRef`-disambiguated so two drafts from one provenance never collide), the `Recording*`/`Replay*` decorators over the core `DraftExtractor`/`DraftClassifier` ports, and the EXTERNAL-expected-hash integrity gate (`FixtureIntegrityError` on a content+hash co-rewrite, never a circular self-hash). A replay MISS throws `ReplayMissError` (never a safe-default), a recorded `[]`/`{behavioral, error-default}` replays as a real row, and a duplicate `(adapterKind, inputKey)` throws `DuplicateRecordError`. STUB-orchestrator-only — NO live LLM, NO network, NO prompts (those are slice 5b-ii); core is unmodified.

### Patch Changes

- @mmnto/totem@1.69.0

## 1.68.0

### Minor Changes

- 08cbece: ADR-111 Gate-1 miner slice 5a — the live `ReviewThreadSource` adapter + #2201 resolved-thread filtering as a before-promotion gate (mmnto-ai/totem#2201). Deterministic-core / IO-at-the-edge; no LLM (the live LLM adapter is slice 5b).
  - **New drop reason `resolved-rejected`** (`@mmnto/totem` `spine/ledgers` `DropReasonCodeSchema`) — an ELIGIBILITY rejection, semantically distinct from the existing four: the content WAS fetched (not `unreachable`), CAN be complete (not `truncated`), PARSES (not `unparseable`), and has intact provenance (not `incomplete-provenance`). It fires when every human comment lived on review threads whose resolution status (`isResolved || isOutdated`) marks them superseded contamination.
  - **`ReviewThread` gains `isResolved` / `isOutdated`** (`@mmnto/totem` `spine/extract`) — the per-thread resolution signal the adapter SURFACES from the GitHub `reviewThreads` payload. Contract-owner ruling: **surface, don't filter** — the adapter fetches resolved/outdated threads WITH their flags; CORE decides eligibility and drop-ledgers every rejection (§8 "every rejection ledgered" + the FM). A server- or client-side `isResolved:false` pre-filter is forbidden (it would silence the rejection).
  - **`runExtractStage` applies the resolution-eligibility gate** (BEFORE the completeness check): filter out `isResolved || isOutdated` threads, then — pre-filter content had ≥1 human comment but survivors have 0 → drop `resolved-rejected` (detail carries `N of M threads resolved/outdated; 0 eligible human comments remain`); pre-filter was already thin (0 human comments) → keep `truncated`; survivors have ≥1 human comment → draft from the SURVIVING threads only. The decision stays in deterministic, network-free core.
  - **New live CLI `ReviewThreadSourceAdapter`** (`@mmnto/cli` `commands/spine-review-thread-source`) — implements the core `ReviewThreadSource` port via the established `gh api graphql` exec pattern (Tenet-21, no bespoke GraphQL client). Fetches `reviewThreads { isResolved, isOutdated, path, comments { author, body } }` + the merge-commit oid, maps to `ReviewThreadContent` with the per-thread flags, and routes per-PR failures to the discriminated `FetchResult` (network/not-found → `unreachable`; malformed/unmappable/paginated-past-one-page → `unparseable`) — never throwing, so the orchestrator does not abort on one bad PR. Constructible + exported now; wiring into the spine `run` orchestrator is slice 5c.

  Scope note: this is the deterministic FRONT of the certifying run. The LLM `DraftExtractor` adapter (slice 5b) and the orchestrator wiring (slice 5c) remain open.

### Patch Changes

- Updated dependencies [08cbece]
  - @mmnto/totem@1.68.0

## 1.67.1

### Patch Changes

- 47a1fd3: Wind-tunnel corpus enumeration now walks lc history in **ancestry (topological) order**, not commit-date — `totem spine windtunnel` enumerates merged PRs via `git log --topo-order` (mmnto-ai/totem#2189 item 2 follow-up).

  A `bounded` selectionRule window takes "the N most recent qualifying PRs" off the front of the enumerated list, so "most recent" must mean N-most-recent-by-ancestry, never by timestamp (ADR-110 §6 ancestry-not-timestamp; strategy-claude 2026-06-18 ruling). Commit dates are non-monotonic and rewritable (rebases, clock skew), which would make a bounded window's membership non-deterministic. The reachable PR **set** is unchanged either way (so the certifying `window: all` path is unaffected); this hardens the `bounded` path against a future non-linear merge or date-skewed history.
  - @mmnto/totem@1.67.1

## 1.67.0

### Minor Changes

- 2f4e99c: Wind-tunnel S4 corpus re-derivation (mmnto-ai/totem#2189 item 2) — the deterministic `selectionRule(asOfCommit)` resolver behind ADR-110 §6.
  - **New pure module `@mmnto/totem` `spine/selection-rule`** — the offline, deterministic corpus predicate (no GitHub-API fields, §4): `selectionRulePredicate` (code-touching + bot + revert-itself), the two-pass `resolveSelectionRule` (drops a revert PR AND its in-window target, fail-safe when the target is out-of-window), `isCodeTouching` (frozen classifier; exclude wins at the file level), `isBotIdentity` (`[bot]` suffix), `parseRevertSha`, `parsePrNumber` (trailing `(#N)`; no-ref → skip, malformed → throw), and `diffPrSets`/`prSetsEqual` (order/duplicate-invariant set-equality).
  - **`windtunnel.lock.v1` gains additive-optional `corpus.selectionRule` fields**: `codePathClassifier {includeGlobs, excludeGlobs}` (required at certifying resolve), `excludeRevertPairs` / `excludeBotPrs` (default `true`). Existing harness locks parse unchanged.
  - **`totem spine windtunnel freeze` corpus-completeness (S4) is now a hard gate at the certifying phase**: it re-derives the code-touching PR set from lc's squash history and throws on any `resolvedPrs ≢ selectionRule(asOfCommit)` divergence (naming the missing/extra PRs). The harness phase stays warn-only. All git output is CRLF/path-separator normalized.

  Scope note: this is item 2 of #2189. Item 1 (wire the resolver into the certifying `run`'s pre-scoring gate) remains open on strategy#516.

### Patch Changes

- Updated dependencies [2f4e99c]
  - @mmnto/totem@1.67.0

## 1.66.0

### Patch Changes

- 3484fd4: Ratify wind-tunnel scorer verdict semantics (mmnto-ai/totem#2189, post-#2188 deferral item 3) per strategy-claude's 2026-06-17 verdict-semantics ruling (refines ADR-110 §4/§5):
  - **FAIL outranks the masquerade guards.** `scoreWindtunnel` now evaluates the FAIL tier (confirmed-FP, vacuous positive control) before the exposure-floor and cull-rate guards. A confirmed FP under a thin exposure no longer masquerades as HONEST-NEGATIVE — the guards may only demote a would-be PASS, never upgrade a FAIL.
  - **`WindtunnelVerdict.precision` is now `number | null`.** A real value only on verdicts that make a precision claim (PASS = 1.0; confirmed-FP FAIL = the breaching value, which is the evidence); `null` (not-computed) on every no-claim verdict (exposure-floor / cull-rate / needs-adjudication HONEST-NEGATIVE, and vacuous-control FAIL). This migrates the prior `precision: 0` placeholder — `0` is now reserved for a real all-FP measurement and never means "not computed".
  - **New `WindtunnelVerdict.diagnostics.survivorPrecision`** carries the informative TP/(TP+FP)-over-survivors ratio, separately namespaced from the certifying `precision` and never part of the gate decision.
  - Guard-tripped `HONEST-NEGATIVE` returns (exposure-floor / cull-rate) now report **truthful** `nonVacuity` (the computed value, not a hardcoded `false`) and a **populated** `needsAdjudication` array when unlabeled firings co-occur — a consequence of hoisting the labeling pass ahead of the masquerade guards. Consumers keying on `needsAdjudication.length` will now see that signal on guard-tripped runs where it was previously suppressed.

  CLI `totem spine windtunnel run` output now prints the null-guarded certifying `precision` plus a `survivorPrecision` diagnostic line.

- Updated dependencies [3484fd4]
  - @mmnto/totem@1.66.0

## 1.65.0

### Minor Changes

- 1c3e4d7: Gate-1 wind-tunnel CLI (mmnto-ai/totem#2188): add `totem spine windtunnel freeze` and `totem spine windtunnel run` commands with `--lc-dir` / `TOTEM_LC_DIR` option, git-derived freeze proof (C3), phase rejection for harness→certifying (P1), shared post-image readStrategy (S1/C1), and mock engine for harness-phase validation (OQ2).

### Patch Changes

- Updated dependencies [1c3e4d7]
  - @mmnto/totem@1.65.0

## 1.64.2

### Patch Changes

- 939e699: feat(spine): explicit provenance/ruleClass marker on compiled rules — retire the #2181 engine-type advisory proxy (#2183)

  Adds the durable Gate-1 legitimacy marker that replaces the interim #2181 engine-type proxy with a first-class enforcement attribute, per ADR-110 §2/§3 and Proposal 299 Amendment 1.
  - **Core (`@mmnto/totem`):** new optional `legitimacy` record on `CompiledRule` — three peer legs mapping 1:1 onto the ADR-110 §3 bar (`provenance` / `positiveControl` / `negativeControl`), with a mechanically-validated `ProvenanceRecord` (`mergedPr`, `reviewThread`, `commitSha`) — plus an optional derived `ruleClass`. A pure `deriveRuleClass()` helper encodes the 3-part bar (hard iff legitimacy present, the rule is promoted via the existing ADR-089 `unverified` flag, and both controls pass). A schema invariant on `CompiledRuleSchema` requires `legitimacy` and `ruleClass` to be present-together-or-absent-together and consistent, so a forged or inconsistent stamp fails to parse at the runtime-load boundary.
  - **CLI (`@mmnto/cli`):** `totem lint` now derives the hard tier from `ruleClass` when present and falls back to the engine-type proxy only for un-stamped legacy rules. The severity gate is unchanged (blocking = hard tier AND error-severity), and the frozen-lesson advisory label is scoped to legacy rules so a minted advisory rule is never mislabeled.

  Additive and backward-compatible: existing rules carry neither field, fall through to the legacy proxy with identical behavior, and serialize byte-identically (no compile-manifest churn). The `deriveRuleClass` helper is intentionally **unwired** from the frozen compile pipeline — spine rule-regeneration (strategy#516) is the sanctioned writer.

- Updated dependencies [939e699]
  - @mmnto/totem@1.64.2

## 1.64.1

### Patch Changes

- b7fac0a: Advisory-ize the frozen-lesson regex rule class in the local pre-push `totem lint` gate via an engine-type split. Regex-engine compiled-lesson rules are now advisory — printed, but excluded from the exit-1 tally regardless of severity — while `ast`/`ast-grep` structural rules stay hard-blocking. This stops the frozen-lesson false-positive flood (un-recompilable under the rule-compilation freeze) that was forcing `--no-verify` on every push, matching the advisory posture already applied to the CI Totem Lint job (#2181, #2182).
  - @mmnto/totem@1.64.1

## 1.64.0

### Minor Changes

- 7179daa: fix(sync): self-heal orphaned chunks via working-tree reconciliation (mmnto-ai/totem#2151). Incremental `totem sync` now derives deletions by reconciling indexed paths against the working tree (`computeOrphanPaths` + new `LanceStore.getDistinctPaths()`) instead of from the git diff window, so chunks for files deleted, renamed into an ignored dir, newly ignored, or de-targeted are purged even when the baseline already advanced past the change — the prior class left them orphaned until `totem sync --full`. Comparison is separator-normalized but deletion uses the raw stored path (legacy backslash rows are neither false-purged nor missed). A purge-only sync now also rebuilds the FTS index so it drops the orphaned content, and the run reports an `orphansPurged` count.

### Patch Changes

- Updated dependencies [7179daa]
  - @mmnto/totem@1.64.0

## 1.63.0

### Minor Changes

- 92e852f: feat(spec,review): code-blind grounding guard — when `totem spec` / `totem review` retrieve zero code chunks, surface an advisory banner ("no code context — architecture claims unverified") and fold a suppression directive into the orchestrator prompt so the model degrades to the retrieved specs/sessions/lessons instead of confabulating file/type/system specifics (the lc#463 "invented a whole architecture" class). Interim fail-loud guard per strategy#474: the command still runs — it does not disable. The banner is the deterministic, code-emitted signal; the prompt directive is best-effort. Fires strictly on 0 code, independent of specs/sessions/lessons. The guard's activation is recorded on `RunMetadata.codeBlind` so run artifacts (eval fixtures, #2100) are filterable by it. Hard structural post-checks remain the #474 redesign (mmnto-ai/totem#2103). (mmnto-ai/totem#2106)

### Patch Changes

- Updated dependencies [92e852f]
  - @mmnto/totem@1.63.0

## 1.62.0

### Minor Changes

- eec7060: Distributed cohort-freeze read + freeze-aware verify-manifest verdict (mmnto-ai/totem#2167 + mmnto-ai/totem#2137; strategy#584 sub-tasks 2–4). Core: `FreezeEntrySchema` gains `scope: 'local' | 'cohort'` (default `local`) and an optional schema-validated kebab `id` (the stable machine match key); new exports `readCohortFreezes(cwd, packageName)` (never-throws distributed reader off the installed doctrine snapshot — distinct `ok | absent-package | absent-file | corrupt` channel statuses, read-time `scope: cohort` leak filter, warnings returned in the result, zero-network) and `readEffectiveFreezes` (local ∪ cohort union with per-entry provenance + per-source status that survives to every surface; the local read keeps its ADR-109 fail-closed throw), plus `RULE_COMPILATION_FREEZE_ID`. CLI: orient's PARKED section and the SessionStart projection render cohort entries with `[cohort @ strategy-doctrine <v>]` provenance and the channel state distinctly (a corrupt snapshot is loud; honest absences are distinguishable); doctor gains a sensor-only `Freeze state` row (warn-class at most — never gates); `verify-manifest` consults the effective freeze and, when an entry with id `rule-compilation` is active at ANY provenance, downgrades lesson-only staleness (input-hash mismatch only) from block to warn — push proceeds with zero compile invocation and zero artifact churn while the freeze stands. Output-hash drift still fails regardless of freeze state; no freeze visible keeps 1.61.0 behavior; any consult failure degrades to no-freeze-visible (conservative block). The gate change covers the pre-push hook, CI, and manual runs through the one CLI command — no hook re-install anywhere.

### Patch Changes

- Updated dependencies [eec7060]
  - @mmnto/totem@1.62.0

## 1.61.0

### Patch Changes

- Updated dependencies [b5f0bf5]
  - @mmnto/totem@1.61.0

## 1.60.0

### Minor Changes

- 2ed31d0: Seat discovery derives from the orchestration directory layout, and the mail scan horizon stops eating self-addressed dispatches (mmnto-ai/totem#2141 + #2144). Core: `resolveSelfAgents` gains a dirs∪map layer — any `.totem/orchestration/<seat>/` directory registers that seat (repo+1 touches zero surfaces; the totem-codex exhibit), unioned with the basename map so roster siblings stay visible on partial-dir fresh clones; `source` reports `'dirs'`/`'dirs+map'` honestly; a `config.json host_agents` that omits a PRESENT seat dir keeps its replace semantics but now attaches a loud warning naming the omitted seat (the silent-unbind class); `knownCohortAgents(workspace?)` admits dir-registered seats as known recipients. CLI: `pollMail` reads bounded header windows instead of whole files (a >window header rejects LOUD, never silently), scans self-token filenames first while everything else holds today's global newest-first baseline (a filename token can promote but never demote — ordering must not become delivery), raises `MAX_SCAN` 500→5000 so the cap is a backstop instead of the operating regime, and emits a DIRECTED truncation warning naming self-addressed-looking files dropped beyond the horizon; `mail send`/`reply` gain `--workspace` for dir-derived recipient validation.

### Patch Changes

- Updated dependencies [2ed31d0]
  - @mmnto/totem@1.60.0

## 1.59.1

### Patch Changes

- 9489d0e: Hotfix: 1.59.0's prefer-local re-exec crashed the parent's exit path after every SUCCESSFUL delegation — cross-spawn fills `error: null` (not `undefined`) on success, and the spawn-failure check read `.message` off the null. The child's work completed but the invoking process exited 1 with a raw TypeError. Caught on the first live delegation; the success shape is now regression-locked in tests.
  - @mmnto/totem@1.59.1

## 1.59.0

### Minor Changes

- 74a8475: Prefer-local re-exec at the entrypoint (mmnto-ai/totem#2018 L1). When a foreign totem binary — typically an ambient global install — starts inside a project that carries its own `@mmnto/cli` (workspace-HEAD build or pinned dependency, the ADR-072 cascade's deterministic tiers), it now delegates to the project-local build instead of running with the wrong dependency tree. The delegation is announced on stderr; `TOTEM_NO_REEXEC=1` opts out. Forecloses both variants of the recurring wrong-binary class: missing externalized peer SDKs (mmnto-ai/totem#2018) and stale-version shadowing (mmnto-ai/totem#2053).

### Patch Changes

- @mmnto/totem@1.59.0

## 1.58.1

### Patch Changes

- cfeb312: Context-correct remediation for missing externalized LLM SDKs (mmnto-ai/totem#2018 L2). When `@google/genai` / `@anthropic-ai/sdk` / `openai` fail to import, the error now branches on what is actually true on disk: SDK installed but unresolvable from the running binary → points at the project-local CLI (`pnpm exec totem`) and names the global-install cause; totem workspace checkout → points at the workspace build; genuinely missing → project-local install hint with the externalized-by-design context. No branch suggests a global install — verified on #2018 to be a dead end.
- Updated dependencies [cfeb312]
  - @mmnto/totem@1.58.1

## 1.58.0

### Minor Changes

- 44a0a23: feat(orchestrator): backend admission contract (#2102, strategy#474 slice 3).

  Both orchestrator seams are additively enriched with the adopted contract fields. Core gains `OutputContract` (`citationsRequired` / `verifyFallback` / `schema` — closed object), `ContextPolicy` (`budget`, validated `int().positive()`, unit: input tokens), `RunMetadata` (`caller` / `command`), an optional top-level `admission` group on the run artifact (additive 1.x — never inside `inputBundle`, so `inputHash` rerun/compare identity is untouched), the `ADMISSION_SELF_GROUNDING_AGENT` constant + `ADMISSION_CLASSES` tuple, and the inferred `BackendAdmissionClass` type. `OrchestratorInvokeOptions` and `runOrchestrator` gain six optional fields (`task`, `groundingBundle`, `backendAdmissionClass`, `contextPolicy`, `outputContract`, `runMetadata`) — providers stay pure transport (vendor payloads are byte-identical), and omitting every field is byte-identical to today. Admission is decided per RESOLVED backend before EACH invoke: a requested class above `completion_only` must be declared in the new `orchestrator.capabilities.admissionClasses` config field or the run fails loud before any tokens are spent, and a cross-provider quota fallback under an elevated class fails before the fallback invoke (primary + admission errors reported together). `groundingBundle` reconciles with `artifact.bundle` (mismatched hashes = hard ambiguous-grounding-identity error). `rerunArtifact` replays a recorded admission group + elevated class verbatim (no silent downgrade); `compareRunArtifacts` gains `sameAdmission` + `admissionDelta`. The spec and review callers now supply `backendAdmissionClass` + `runMetadata` explicitly.

### Patch Changes

- Updated dependencies [44a0a23]
  - @mmnto/totem@1.58.0

## 1.57.0

### Minor Changes

- 02dfaea: feat(doctor): 296 deliverable-1 doctor-side — promoted manifest fields + capability-probe detector family + declared-floor verdict rendering (#2140)
  - Parse the four promoted optional parity-manifest fields (`manifestation:`, `senses:`, `vendor-adapter:`, `repo-role-variance:`) into `ParityContract` — max-tolerance at the raw boundary (one mis-shaped or future value narrows per-row, never a manifest-wide outage), honest-absent mapping, `schema-version` unchanged.
  - New `detectCapabilityProbeContract` core detector + CLI probe registry routing `manifestation: capability-probe` rows: `knowledge-search-access` (`.mcp.json` registration, present rung) and `claude-settings-minimum-capability` (settings suppression sensing; absent file = pass). Verdicts carry the probed level; when a row declares a stronger `senses:` than the probe proves, the verdict caps at `unknown` (the green-halo guard).
  - The `semver.minVersion` fallback in version-pinned (and vendor-SDK attestation) verdicts now renders as a `declared`-level claim with the originating range — never reads as installed-level (296 §6(a)3 post-#605).
  - Bump `@mmnto/strategy-doctrine` to 0.1.5 (the promoted 26-contract manifest, the floor this build senses).

### Patch Changes

- Updated dependencies [02dfaea]
  - @mmnto/totem@1.57.0

## 1.56.0

### Minor Changes

- d1c338d: feat(cli): `totem mail send` / `mail reply` outbound actuator (#2042)

  Adds the actuator half of the ADR-106 coordination triad (the sensor `totem mail`
  already shipped). Before this, `totem mail send` silently fell through to the read
  command and every dispatch was hand-authored against five undocumented conventions —
  a discipline the protocol structurally could not satisfy (Tenet 13: sensor without
  actuator).
  - `totem mail send --to --subject [--from --body-file --in-reply-to --priority --related --expected-action --slug]`
    composes + writes a **ADR-098 v0.4-compliant** dispatch (`schema:` / `timestamp:` /
    `expected-action:`) to the sender's own outbox; totem is now the first v0.4-compliant
    emitter. `totem mail reply <source>` is sugar that infers recipient + subject + `in-reply-to`.
  - The write-side validator is **fail-open** (ADR-106 inv6): structural validity is
    enforced by construction (a malformed-shape dispatch is unrepresentable), while content
    predicates that can't be guaranteed at construction (unknown recipient, empty refs) emit
    a **loud emit-time warning** and write anyway — a blocked dispatch is worse than a
    malformed one (#2119). Usage errors (missing to/subject, ambiguous/unresolvable self,
    unreadable body-file) and actuation failures stay hard-fail (Tenet 4).
  - Registering the subcommands also closes the silent fall-through: `totem mail <unknown>`
    now hard-errors instead of running the read as a no-op.
  - `parseHeader` now reads `timestamp:` (v0.4 canonical) with `date:` backwards-compat
    fallback; the surfaced `MailEntry.date` field name is unchanged (no blast-radius rename).
  - `@mmnto/totem` exports `knownCohortAgents()` — the single source of truth for the
    recipient set, derived from the cohort map (a hardcoded list in the actuator would
    re-introduce the very drift this command fights).

  Emit-shape + the reader change concurred by strategy-claude (ADR-098 owner); OQ-1 ruled 1b.

### Patch Changes

- Updated dependencies [d1c338d]
  - @mmnto/totem@1.56.0

## 1.55.1

### Patch Changes

- af21102: fix(review-learn): skip declined bot findings from lesson extraction

  `totem review-learn` now recognizes the canonical decline vocabulary — `decline`/`declined` and the `decline-*` classes (doctrine bot-protocols.md §8.1) — in inline review replies, so a soft-decline ("addressed — declined, it's by design") is no longer misread as resolved and laundered into a lesson. Declined findings carry an explicit `disposition` and are surfaced with an auditable breadcrumb instead of a silent skip (the reference for mmnto-ai/totem#2038 reason-code backfill). Closes mmnto-ai/totem#2124 (Surface A; the round-comment-table surface defers to the mmnto-ai/totem-strategy#474 disposition-ledger).
  - @mmnto/totem@1.55.1

## 1.55.0

### Minor Changes

- 5256cb5: feat(orchestrator): grounding bundle with day-one provenance classes (#2101, strategy#474 slice 2).

  Every run artifact now carries a per-item `grounding.bundle`: each delivered evidence item self-describes its provenance class (`similarity-only` | `structurally-verified` | `spec-contract` | `compiled-rule` — open vocabulary with canonical constants, consumers fail-safe-down on unknown classes), its identity (`sourceType`, `filePath`, optional `sourceRepo`; absent = the run's own repo), and a `contentHash` (identity, never bytes — the masked prompt already carries content once). The first cut wraps existing retrieval honestly as `similarity-only`; structural resolvers (#344/#375) graduate items later. `grounding.hash` becomes the deterministic hash of the bundle (recomputable from the artifact surface alone) and `provenanceSummary` is derived as a sorted class-count string (`similarity-only:14`; zero items → `ungrounded`). Bundle items are canonically sorted so retrieval order never moves the hash. Reruns carry the bundle verbatim. `RUN_ARTIFACT_SCHEMA_VERSION` bumps to 1.1.0 (additive; the version-tolerant reader parses slice-1 artifacts unchanged — they cannot be re-classed and stay as-is). New core exports: `GroundingItemSchema`, `GroundingBundleSchema`, `buildGroundingBundle`, `summarizeProvenance`, `PROVENANCE_CLASSES`, `PROVENANCE_UNGROUNDED`.

### Patch Changes

- 7cebd71: feat(doctor): wire the `last-attested:` manifest field through to manual-attestation rows (#2125). The parity-manifest schema parses the optional ISO-8601 `last-attested:` date (strategy#540) into `ParityContract.lastAttested`, and `doctor --parity` passes it to the detector's reserved `attested?:` seam — dated rows render `last attested <date>`, undated rows keep the honest `last attested: not recorded`. Message refinement only; the manual-attestation verdict ceiling (`info`/`skip`, never fails) is unchanged. Ships with the `@mmnto/strategy-doctrine` 0.1.3→0.1.4 pin bump that distributes the first attestation dates.
- Updated dependencies [5256cb5]
- Updated dependencies [7cebd71]
  - @mmnto/totem@1.55.0

## 1.54.1

### Patch Changes

- d27675c: fix(cli): `totem mail` no longer silently drops frontmatter-only dispatches over 2 KiB (#2118), and `totem mail --json` actually emits JSON (#2097).

  `parseHeader` now parses to the closing `---` frontmatter delimiter instead of splitting on the first blank line — the old parser rejected any >2 KiB file without a blank-line separator, which silently dropped every cohort-convention dispatch (whole message in `subject:`, zero blank lines; 8/8 of the observed misses, up to 4,163 bytes of genuine frontmatter). The byte cap now bounds the closing-delimiter search window (16 KiB) instead of rejecting the file, and every mail-shaped parse rejection emits a structured warning (parity with the module's other failure paths) while non-mail-shaped strays stay silent by design. The `--json` flag was being swallowed by the program-level `--json` option (commander parent/child collision); the mail action now reads `optsWithGlobals()`.
  - @mmnto/totem@1.54.1

## 1.54.0

### Minor Changes

- 2d7210e: feat(orchestrator): grounded single-run artifact + rerun/compare primitives (#2100, strategy#474 slice 1)

  Every opted-in orchestrator run (spec + review standard verdict, always-on) now emits an immutable, content-addressed JSON record under `.totem/artifacts/runs/<sha256>.json`: the post-DLP masked prompt bundle, grounding hash + provenance summary (`similarity-only` wholesale in this slice), the RESOLVED backend (post quota-fallback) with admission class, and the output + metrics. Response-cache hits emit nothing — artifacts record actual invokes. Emission is strictly additive (`runOrchestrator` return contract unchanged; non-opted callers byte-identical) and never fails the run.

  New primitives + thin verbs: `totem artifact rerun <hash>` re-invokes the exact stored bundle against the recorded backend (bypassing retrieval AND the response cache) and appends a new record; `totem artifact compare <a> <b>` returns a deterministic structural diff (equality flags, content hashes, numeric metric deltas — no similarity scoring). Core exports `RunArtifactSchema` with a version-tolerant reader (accepts any 1.x; migration-on-read registry for majors) so the accumulated fixture corpus survives schema evolution.

### Patch Changes

- Updated dependencies [2d7210e]
  - @mmnto/totem@1.54.0

## 1.53.9

### Patch Changes

- c8d38f0: feat(cli): `totem lint`/`totem review` gain `--branch` and `--base <ref>` to force the push-gate (branch-vs-base) diff scope regardless of working-tree state (#2091); conflicting scope selectors (`--staged`, `--diff`) hard-error instead of silently winning. `totem lint` additionally warns when its auto-selected `uncommitted`/`staged` scope is narrower than what the pre-push gate will check, with the exact file-count gap (#2090). Both close the local-PASS-hides-gate-failures trap (#2055).
  - @mmnto/totem@1.53.9

## 1.53.8

### Patch Changes

- 79c3326: feat(cli): `totem init --doctrine` wires `orient.parityManifest` to the installed `@mmnto/strategy-doctrine` pin (Proposal 292 S1). Detects the pin in `node_modules` and writes only the config pointer (no `package.json` mutation); honest-absent when the pin is missing. Lets `totem doctor --parity` sense cohort drift once the manifest package is installed.
  - @mmnto/totem@1.53.8

## 1.53.7

### Patch Changes

- 26db922: `totem doctor --strict` now exercises the parity sensor when a repo-local `orient.parityManifest` is configured — closing the "green-by-not-checking" gap where consumer CI (which runs `--strict`, not `--parity --strict`) never ran the drift check (mmnto-ai/totem-strategy#545 Half 2).

  Zero churn for non-adopters: a repo that hasn't configured a manifest sees byte-identical `--strict` output (the fold is a no-op until you opt in). Per ADR-109 / Tenet 13 the throw-gate stays at the CLI edge, and the standalone `doctor --parity` is unchanged.
  - @mmnto/totem@1.53.7

## 1.53.6

### Patch Changes

- a62f1c2: `totem doctor --parity` now senses drift across all three tractability classes (the completing slice of the doctor --parity sensor, totem-strategy#448).
  - **mechanical content-equality** — managed-block skills (`.claude/skills/*/SKILL.md`), the four per-repo-regenerated git hooks (`.git/hooks/*`, catching stale-version drift), and the static whole-file SessionStart hooks (`.claude/hooks/SessionStart.cjs` + `.gemini/hooks/SessionStart.js`).
  - **version-pinned** — `@mmnto/*` cohort-floor pin-currency for the dependency contracts.
  - **manual-attestation** — the no-mechanical-sensor class (doctrine-currency rows + vendor-SDK couplings) surfaced as `info`/`skip` only, never failing.

  All detection is strictly local-read-only — no network, no cross-repo fetch. Verdicts split `pass`/`warn`/`info`/`unknown`/`skip`, and only a `blocking` drift gates under `--strict`.

- Updated dependencies [a62f1c2]
  - @mmnto/totem@1.53.6

## 1.53.5

### Patch Changes

- 00e62a4: fix(hooks): generated git hooks resolve the pinned / in-tree totem build before a volatile ambient global (mmnto-ai/totem#2053 / mmnto-ai/totem#2055).

  `buildResolveBlock` checked `command -v totem` (the PATH-global) **first**, contradicting its own "prefer local workspace build" comment — so in a dev monorepo the hook ran a stale globally-installed `@mmnto/cli` against HEAD code, enforcing a 2-versions-stale ruleset (the `lesson-1ef06d16` global-vs-local divergence root cause).

  The generated resolve cascade is now, in order: workspace-HEAD (`node packages/cli/dist/index.js`) → pinned `node_modules/@mmnto/cli/dist/index.js` → `pnpm exec totem` → `command -v totem` (PATH) → package-manager `dlx` fallback. Each pinned tier is **identity-guarded on the `@mmnto/cli` package** (tier-1 greps the package name + built dist; tier-2 targets `@mmnto/cli`'s own entry rather than a bare `totem` bin name a colliding package could shadow). Preferring the lockfile-pinned / in-tree build over a volatile ambient global is Tenet 14 (never tie governance to volatile state) applied at the resolver; ADR-072 §2's "PATH beats dlx" intent is preserved. Fixes all generated hooks (pre-push, post-merge, post-checkout) through the shared block. Scoped to the template only — already-installed stale hooks self-heal via the versioned-hooks upgrade (mmnto-ai/totem#1854).
  - @mmnto/totem@1.53.5

## 1.53.4

### Patch Changes

- faf7356: fix(core): `totem review`/`lint` branch-vs-base diff prefers `origin/<base>` over a stale local ref, so false-CRITICALs can't false-block the push gate (mmnto-ai/totem#2054 / mmnto-ai/totem#2055).

  `getGitBranchDiff` tried the local `<base>` ref before `origin/<base>`. On a feature-branch workflow the local default branch is never checked out, so it is stale (or absent); `git diff <stale-base>...HEAD` then re-includes already-merged code as "new" — manufacturing false-CRITICAL review findings that block the push gate (the review hook will not stamp on a FAIL) and inflating the diff into the 50k truncation cliff.

  It now prefers the remote-tracking `origin/<base>` (the current merged base), falling back to the local ref only when origin is absent (offline / no-remote / shallow CI). Three-dot `...HEAD` already resolves merge-base, so this stays a local, no-network change — no fetch added. Fixes `review`, `lint`, and `verify-badges` through the shared helper. Part of the gate-correctness cluster (mmnto-ai/totem#2055).

- Updated dependencies [faf7356]
  - @mmnto/totem@1.53.4

## 1.53.3

### Patch Changes

- 5e0f029: fix(verify-manifest): hash git-tracked lessons only, so an untracked scratch lesson can't block an unrelated push (mmnto-ai/totem#2051 / mmnto-ai/totem#2055).

  `generateInputHash` walked every `.md` under `.totem/lessons/` including untracked files, so a single MCP `add_lesson`/`extract` scratch lesson diverged the compile-manifest input hash and tripped the pre-push `verify-manifest` gate (plus `lint`/`status` staleness) on changes that never touched lessons — the working-tree-scope class of mmnto-ai/totem#2051.

  It now takes an optional repo cwd and, inside a git repo, hashes only git-tracked lessons; untracked working-tree scratch is excluded. Both the consumers (`verify-manifest`, `lint`, `status`) and the producer (`totem compile`) pass the cwd, so producer and consumer stay symmetric even if compile runs with an untracked lesson present — no asymmetry, no recompile forced, and consumer manifests with no untracked lessons are unaffected. Outside a git repo, or on any git error, it falls back to the prior all-files walk (a new `listTrackedFilesUnder` core helper resolves the tracked set, NUL-delimited and cross-platform). Part of the gate-correctness cluster (mmnto-ai/totem#2055).

- Updated dependencies [5e0f029]
  - @mmnto/totem@1.53.3

## 1.53.2

### Patch Changes

- 780a271: feat(cli): orient cohort distribution (WS2 PR-3, #2044) — two parts:
  1. `totem orient --session` render mode: emits the bounded session-orientation block for a SessionStart hook to inject. Reuses the shipped `deriveOrientReport` + `renderOrientForSession`, so the CLI surface, the `--json` report, and the in-process hook cannot diverge. Boot-safe per the SessionStart contract — never throws or exits non-zero, emits nothing when there is no high-signal state (the hook omits the block), and skips the hard `gh` gate so a consumer without `gh` degrades to fail-loud "could not derive" lines instead of an error banner.
  2. The scaffolded SessionStart hooks (`CLAUDE_SESSION_START` + `GEMINI_SESSION_START`) now append `totem orient --session` after `totem describe` — additively (Tenet 13: `describe` = static identity sensor, `orient` = live in-flight sensor; append, never replace), each in its own boot-safe try/catch. New consumers get live derived orientation at session-start automatically; existing consumers pick it up on their next hook re-scaffold.
  - @mmnto/totem@1.53.2

## 1.53.1

### Patch Changes

- a7bfb4a: `totem orient` session-start auto-injection (WS2 PR-2): add programmatic `deriveOrientReport` and `renderOrientForSession` exports so the SessionStart hook injects derived, bounded orientation (parked subsystems, open PRs, board↔issue coherence drift, a counts pointer) into the session payload.
  - @mmnto/totem@1.53.1

## 1.53.0

### Minor Changes

- 1d879fc: feat(cli): `totem orient` — derive session orientation from primitives (zero LLM)

  New `totem orient [--json]` command (WS2, #2044). A deterministic sensor that
  derives "what's parked / in flight / open" from live `gh` / `git` / fs
  primitives — `.totem/freeze.json` parked entries, open PRs (with `[draft]`),
  the in-flight GH Project board, epics + sub-issues (with a cross-repo parent
  guard), other open issues, and a one-line index-freshness pointer — each line
  citing its primitive. Adds one new derived signal: a board↔issue **coherence**
  flag (an active board card whose issue is closed/absent = drift), computed by a
  pure predicate from the board + open-issue primitives orient already fetched
  (no extra `gh` call). Sibling to `totem triage` (LLM synthesis on top); they
  compose, not duplicate.

  Honest by construction: every section is its value or an `{ error }` envelope —
  nothing silently omitted (Tenet 4); "not yet synced" / "no board configured"
  are explicit absences, not errors (Tenet 14); the footer states the output is a
  snapshot/cache, not a source (Tenet 20). Takes no embedding/LanceDB path, so it
  runs green when `@google/genai` is absent.

  Consumer-safety: owner is derived from `gh repo view`; the GH Project number is
  read from the new optional `orient.projectNumber` field in `totem.config.ts`
  (env `TOTEM_ORIENT_PROJECT` overrides last). With no project configured the
  board section is an honest absence — the cohort's board is not baked in.

  Core (`@mmnto/totem`): adds the optional `orient.projectNumber` config field
  (`OrientConfigSchema`).

### Patch Changes

- Updated dependencies [1d879fc]
  - @mmnto/totem@1.53.0

## 1.52.0

### Minor Changes

- d1fc8eb: feat(cli): `totem gate install` + parameterized PreToolUse wrapper + `init --gates=` (WS3 install tail, #2048)

### Patch Changes

- @mmnto/totem@1.52.0

## 1.51.0

### Minor Changes

- ff71d97: feat(cli+core): `totem gate check` action-gate engine + freeze-check reference gate (WS3, #2043)

### Patch Changes

- Updated dependencies [ff71d97]
  - @mmnto/totem@1.51.0

## 1.50.0

### Patch Changes

- @mmnto/totem@1.50.0

## 1.49.3

### Patch Changes

- a1162b7: chore(deps): bump @google/genai 1.44.0 -> 2.6.0 (W5 cohort dep wave)

  Lifts the workspace pin on `@google/genai` from `^1.44.0` to `^2.6.0`, narrows the optional peer envelope in `@mmnto/totem` and `@mmnto/cli` from `>=1.0.0` to `>=2.0.0` to match the major we now test and build against, and bumps the `services/compile-worker` runtime dep in lockstep. Probe-verified API-stable: the four SDK surfaces we use (`new GoogleGenAI({ apiKey })`, `ai.models.embedContent(...)`, `ai.models.generateContent(...)`, plus the `response.text` / `response.usageMetadata` / `response.candidates` read paths) compile and pass tests against 2.6.0's `.d.ts` without code edits.

  ## What ships

  | File                                   | Change                                                        |
  | -------------------------------------- | ------------------------------------------------------------- |
  | `package.json` (root devDep)           | `@google/genai`: `^1.44.0` -> `^2.6.0`                        |
  | `packages/cli/package.json` (devDep)   | `@google/genai`: `^1.44.0` -> `^2.6.0`                        |
  | `packages/cli/package.json` (peerDep)  | `@google/genai`: `>=1.0.0` -> `>=2.0.0` (optional, unchanged) |
  | `packages/core/package.json` (peerDep) | `@google/genai`: `>=1.0.0` -> `>=2.0.0` (optional, unchanged) |
  | `services/compile-worker/package.json` | `@google/genai`: `^1.0.0` -> `^2.6.0`                         |
  | `pnpm-lock.yaml`                       | Regenerated; 2.6.0 resolves cleanly, no peer warnings         |

  ## Empirical baseline (dry-run probe `2026-05-24T2207Z`)
  - `pnpm install` on Node 24 from clean checkout — succeeded; 590 sub-packages resolved (re-verified in main checkout install-of-record at `2026-05-25T0054Z`); no strict peer warnings emitted on resolution. Note: subsequent CI Build & Lint surfaced a `strictDepBuilds` gate on the new `@google/genai@2.x` `prepare` script (1.x did not declare one) — fixed at commit `4600c62e` by adding `@google/genai` to `pnpm-workspace.yaml` `allowBuilds`.
  - `pnpm --filter @mmnto/totem build` (tsc) — zero TS errors against 2.6.0's `.d.ts`.
  - `pnpm --filter @mmnto/cli build` (tsc) — zero TS errors against 2.6.0's `.d.ts`.
  - `src/embedders/gemini-embedder.test.ts` — 15 / 15 pass.
  - `src/orchestrators/gemini-orchestrator.test.ts` — 12 / 12 pass.
  - `src/orchestrators/conformance.test.ts` — 20 / 20 pass.

  The four API surfaces we use (`new GoogleGenAI({ apiKey })` at `packages/core/src/embedders/gemini-embedder.ts:91` and `packages/cli/src/orchestrators/gemini-orchestrator.ts:66`; `ai.models.embedContent(...)` at `gemini-embedder.ts:109`; `ai.models.generateContent(...)` at `gemini-orchestrator.ts:77`; plus the `response.embeddings[].values` / `response.text` / `response.usageMetadata.{promptTokenCount, candidatesTokenCount}` / `response.candidates[0].finishReason` read paths) are all present in `node_modules/@google/genai@2.6.0/dist/genai.d.ts` with signature-compatible shapes.

  ## Why narrow peerDep `>=1.0.0` -> `>=2.0.0`

  After this PR, the workspace tests + tsc build run against 2.x's `.d.ts`; the 1.x compat claim would become false advertising the moment a future change relies on a 2.x-only field or shape. Per grep, zero current cohort consumers import `@google/genai` directly, so nothing breaks on the narrow. The optional-peer posture (`peerDependenciesMeta.@google/genai.optional: true`) means consumers providing a 1.x version get a pnpm warning, not an install error. Matches the W3 engine-strict pattern where the advertised envelope narrowed cleanly once cohort safety was confirmed empirically.

  ## Downstream peerDep flag

  `@google/genai@2.0.0` introduced a new `peerDependency` on `@modelcontextprotocol/sdk@^1.25.2` that was absent in 1.x. Benign for our consumption (root + cli devDep; pnpm did not strict-warn on install), but downstream pack consumers with strict peer enforcement who transitively pull `@google/genai` may see a peer warning unless they also provide an MCP SDK. Documented here so consumers hitting the warning can either provide MCP SDK or enable `auto-install-peers=true`.

  ## Dispositional lineage

  The optional-peer dep posture itself is preserved per the disposition of `mmnto-ai/totem-strategy#404` (Proposal 286, closes prereq `mmnto-ai/totem#2018`). The `(c)` graceful-degradation impl in `totem search` — keyword fallback when the embedder is unavailable — is tracked as a separate follow-on against `mmnto-ai/totem#2018` and ships in its own PR; W5 is the version bump only.

  ## Why this is a PATCH bump

  W5 is a dep-pin bump with no published code-surface delta and no enforced contract change. The optional-peer envelope narrowing is advisory (warnings, not errors). Downstream library consumers who do not import `@google/genai` see nothing change; consumers who do import it and are still on 1.x see a peer warning and can bump at their own cadence. Matches the W4 cohort-dep-wave precedent at `e4a24ec5`.
  - @mmnto/totem@1.49.3

## 1.49.2

### Patch Changes

- 7b2664c: chore(tooling): auto-augment empty cohort-link CHANGELOG headers at `changeset version` time (closes #1969)

  Ships the structural fix for the recurring empty-cohort-header drift class — same pattern that hit cycles 1-5 (`#1965` / `#2009` / `#2016` / `#2021` / `#2024`) and required manual in-place backfills on each auto-VP PR.

  ## What ships
  - **`tools/augment-cohort-changelog-headers.mjs`** — post-`changeset version` script that detects empty `## X.Y.Z` headers in the three pack CHANGELOGs (`packages/core`, `packages/pack-agent-security`, `packages/pack-rust-architecture`) and injects the canonical generic cohort-link note. Idempotent: any header with a non-blank body line is left untouched.
  - **Wiring:** root `package.json` `"version"` script chains `changeset version && node tools/augment-cohort-changelog-headers.mjs` so the auto-VP PRs ship with augmented headers from the first commit.
  - **`tools/augment-cohort-changelog-headers.test.mjs`** — 9-test bare-node suite covering empty-header detection (mid-file + EOF), idempotency, no-op on bodied headers (cli `### Patch Changes` case + already-augmented case), multi-empty-in-one-file with output-shape assertion, malformed-version-header rejection, and the target-list invariant.
  - **One-time historical sweep:** 84 historical empty headers across the three packs (going back to ~1.32) backfilled in the same commit. The detection pattern is universal; restricting the script to "recent versions only" would add complexity for no gain.

  ## Doctrine anchor

  Per strategy-claude's 2026-05-23T2114Z altitude call on `#1969` (with strategy-agy + strategy-codex peer-review concurrence, N=3 cross-vendor):
  - **Option (a) auto-augment**, not (b) native skip (changesets H2 header is hardcoded at apply-release-plan level, not configurable via the `changelog` hook) and not (c) suppress bot findings (right altitude, wrong direction).
  - **Uniform generic note** across all 3 packs, not the asymmetric specific-note pattern that would manually mirror CLI's CHANGELOG content (Tenet 20 stale-mirror trap).
  - **Post-`changeset version` script**, not upstream-changesets RFC (multi-month escalation; declined).

  ## Canonical note text

  ```text
  _Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._
  ```

  Matches the established repo pattern across `1.43.x` / `1.44` / `1.45` / `1.46` / `1.47` / `1.49` cycles. The recently-backfilled `1.49.1` (cycle 5 at `495faba2`) ships with this exact form, so the script's idempotency is verified against live state.

  ## Why this is a PATCH bump

  Build-tooling change with no published-package API surface delta. Future auto-VPs will have augmented pack headers from the start — same artifact as the manual backfill that landed on cycles 1-5, but without the human in the loop.
  - @mmnto/totem@1.49.2

## 1.49.1

### Patch Changes

- e4a24ec: chore(deps): bump packageManager pnpm@9.15.4 -> pnpm@11.2.2 (W4 cohort dep wave)

  Lifts the repo's `packageManager` field from `pnpm@9.15.4` to `pnpm@11.2.2`, migrates the pnpm 11-canonical settings home from `package.json` to `pnpm-workspace.yaml`, and deletes `.npmrc` (single-line `engine-strict=true` superseded by `engineStrict: true` in workspace config).

  ## What ships

  | Change                          | Before                             | After                                                                                                                 |
  | ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | `package.json` `packageManager` | `pnpm@9.15.4`                      | `pnpm@11.2.2+sha512.<corepack integrity>`                                                                             |
  | `pnpm-workspace.yaml`           | `packages:` only                   | `engineStrict: true` + `strictDepBuilds: true` + `allowBuilds` map + `minimumReleaseAge` + `minimumReleaseAgeExclude` |
  | `.npmrc`                        | `engine-strict=true` (single line) | deleted                                                                                                               |
  | `pnpm-lock.yaml`                | `lockfileVersion: '9.0'`           | `lockfileVersion: '9.0'` (pnpm 11 reads v9 lockfiles natively; no regen forced)                                       |

  ## pnpm 11 settings home migration

  pnpm 11 dropped reading the `pnpm.*` field from `package.json` entirely; the canonical settings home is now `pnpm-workspace.yaml`. The five settings landed in this PR:
  - `engineStrict: true` — migrated from `.npmrc engine-strict=true`. Fails workspace install when active Node doesn't satisfy `engines.node` (W3 cohort constraint at `>=24`).
  - `strictDepBuilds: true` — pnpm 11 default; fails install on unapproved transitive `postinstall`/`install` scripts. Companion to `allowBuilds`.
  - `allowBuilds` — map of approved transitive packages that may run install/build scripts. Six packages enumerated (ast-grep/lang-rust, es5-ext, esbuild, protobufjs, tree-sitter-javascript, tree-sitter-typescript). Source: empirical CI iteration enumerated the eight version-pinned variants needing approval; collapsed to six name-keyed entries per pnpm docs' canonical form.
  - `minimumReleaseAge: 1d` — pnpm 11 default; blocks install of packages published less than 24h ago for supply-chain hygiene against immediate-publish attacks.
  - `minimumReleaseAgeExclude: ['@mmnto/*']` — cohort carve-out. Cohort packages publish-then-install in the same CI window by design; the 1d hygiene gate breaks that loop for `@mmnto/*` but stays in force for all third-party transitive deps.

  ## Workflow surface unchanged

  All 7 workflows (`ci`, `ci-integration`, `compile-manifest`, `lint`, `release`, `release-binary`, `totem-doctor`) remain on `pnpm/action-setup@v5` with no `version:` input — the pnpm release is inferred from `packageManager`. The `pnpm/action-setup@v6` line has open inference bugs (`pnpm/action-setup#225`, `#227`) that would have forced an explicit `version: 11.2.2` pin; staying on `@v5` keeps the inference path clean and `packageManager` as the single source of truth.

  ## Cross-stream coordination

  pnpm 11 reads pnpm 9-generated lockfiles cleanly (forward direction; verified empirically). The reverse direction — pnpm 9 reading a pnpm 11-regenerated lockfile — is the cross-stream consumer risk for cohort dependents (liquid-city, totem-status, arhgap11). At merge time a cohort heads-up dispatches the lockfile-format constraint so dependents can bump pnpm in lockstep if they regenerate lockfiles locally.

  ## Lockfile compatibility note

  This PR does NOT regenerate `pnpm-lock.yaml` to a v11-canonical format. pnpm 11 read the existing v9-format lockfile cleanly across all three OSes (`Lockfile is up to date, resolution step is skipped` per the CI log). A v11 regen will happen organically on the next install that produces a resolution diff.

  ## Why this is a PATCH bump

  W4 is a build-tooling change with no published-package API surface delta. Downstream consumers of `@mmnto/cli`, `@mmnto/totem`, `@mmnto/mcp`, `@mmnto/pack-rust-architecture` (and the private `@mmnto/pack-agent-security`) install from npm tarballs and don't see this repo's `packageManager` field or `pnpm-workspace.yaml`. The bump is invisible to library consumers; cohort-dependent repos with their own lockfile regen are addressed via the cross-stream coordination dispatch above.
  - @mmnto/totem@1.49.1

## 1.49.0

### Minor Changes

- 6001f16: feat(cli): `totem init --force-skill-refresh` flag for canonical-marker-less skill files (W3.5)

  Adds a narrow CLI flag that overrides `scaffoldClaudeSkill`'s `preserved` outcome when a distributed Claude skill file lacks the canonical `TOTEM_SKILL_*` markers. Default behavior is unchanged — without the flag, marker-less skill files continue to be preserved with a migration hint. With the flag, the file is overwritten with canonical content and the destructive event is surfaced via a per-file `log.warn` plus a dedicated summary line.

  ## What ships
  - **New CLI flag:** `totem init --force-skill-refresh`
  - **New scaffolder option:** `scaffoldClaudeSkill(path, content, { force?: boolean })`
  - **New result metadata field:** `scaffoldClaudeSkill` returns `forceSuppressed?: true` only when the no-marker guard was suppressed by force
  - **New result metadata field:** `HookInstallerResult.summaryActionOverride?: string` for callers to override the default summary action text
  - **Widened signature:** `AiToolInfo.hookInstaller?: (cwd, opts?: { forceSkillRefresh?: boolean }) => …`

  ## Scope (narrow, per strategy-claude lean at `2026-05-23T1819Z`)

  | In                                                                                           | Out                                                                                                                                     |
  | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
  | Single flag override on the no-marker guard for distributed Claude skills                    | `.claude/settings.json` `permissions.allow` merging (Layer 1, stays in `#2008`)                                                         |
  | Per-file destructive-by-consent warning (only on suppression path)                           | `.mcp.json` dedup (Layer 1)                                                                                                             |
  | Summary line that mirrors the warning text for grep parity                                   | Opt-in hooks (Layer 1)                                                                                                                  |
  | Below-marker user customization stays intact under force (cross-marker contract is separate) | Opt-in baselines (Layer 1)                                                                                                              |
  | Skills only — reflexes (CLAUDE.md / GEMINI.md) are out of scope                              | Refresh-flag cohort (`--refresh-skills` / `--refresh-reflexes` / `--install-hooks` / `--install-baselines`) — Layer 2, stays in `#2008` |

  The bulldoze-everything semantics (overwrite below-end-marker user customization too) intentionally do NOT ship — that's a different command (`--force-skill-replace` or `--scrub`) with its own design pass if/when needed.

  ## Why this exists

  Closes the W3.5 narrow precedent surfaced at [`mmnto-ai/totem#2008`](https://github.com/mmnto-ai/totem/issues/2008). Cohort consumers hitting the canonical-marker mismatch on already-initialized repos had no override path — the only options were manual file deletion (and re-init) or living with stale skill content. The flag is the explicit consent path for the destructive overwrite.

  ## Test coverage

  7 new unit tests covering all 8 invariants from `.totem/specs/2008.md § Implementation Design (W3.5 narrow scope)`:
  1. Default behavior unchanged (no force → marker-less stays preserved)
  2. Force overrides preservation (forceSuppressed: true, content == canonical)
  3. Fresh repo + force is no-op (created outcome, no forceSuppressed)
  4. Below-marker user content preserved under force on marker-bearing files
  5. Marker-bearing files refresh without spurious forceSuppressed flag
  6. Per-skill failure isolation (covered structurally — each iteration is independent)
  7. CLI flag round-trip (Commander → initCommand → installClaudeHooks → scaffoldClaudeSkill; truthy check is `=== true` so default-undefined and default-false both work)
  8. **forceSuppressed is set ONLY on the no-marker suppression path** — locks signal-to-noise discipline (no spurious warns on the normal refresh path)

  Plus an assertion that the preserve-path error hint advertises the `--force-skill-refresh` flag so users discover the override at the moment they hit the preserve outcome.

### Patch Changes

- @mmnto/totem@1.49.0

## 1.48.0

### Minor Changes

- 1c6f0db: chore(engines): declare engines.node across cohort + .npmrc engine-strict (W3 cohort dep wave)

  Adds explicit `engines.node` constraints to all five cohort package.jsons and enables `engine-strict=true` in the repo `.npmrc` so pnpm install fails loudly when the active Node doesn't satisfy the cohort's minimum.

  ## What ships

  | Package                         | engines.node | Why                                                                                                                                                                                           |
  | ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `@mmnto/cli`                    | `>=24`       | The publish workflow pinned Node 24 in [`mmnto-ai/totem#1991`](https://github.com/mmnto-ai/totem/pull/1991) (needs bundled npm 11.x for OIDC); CLI surface built + tested on that same floor. |
  | `@mmnto/mcp`                    | `>=24`       | Matches CLI surface — MCP server is a sibling runtime.                                                                                                                                        |
  | `@mmnto/totem`                  | `>=24`       | Matches CI floor — declared compatibility must equal tested compatibility. See § Cohort tightened to single Node floor below.                                                                 |
  | `@mmnto/pack-rust-architecture` | `>=24`       | Matches CI floor — same anchored-claim discipline as core.                                                                                                                                    |
  | `@mmnto/pack-agent-security`    | `>=24`       | Matches CI floor (`private: true`; symmetric coverage for workspace engine-strict gate).                                                                                                      |

  Plus `.npmrc engine-strict=true` so a workspace install on the wrong Node version fails with `ERR_PNPM_UNSUPPORTED_ENGINE` per Tenet 4 Fail Loud, instead of silently producing a half-installed tree.

  ## CI workflow Node version aligned

  Six CI workflows were on Node 20 or 22, below the cohort's new minimums. Bumped to Node 24 in the same PR so every CI job can satisfy the engines.node constraints it now enforces (the engines.node minimum can't precede the CI floor — workspace install would fail with `ERR_PNPM_UNSUPPORTED_ENGINE` otherwise, as the first push of this branch did across all 3 platforms):

  | Workflow                | Before | After |
  | ----------------------- | ------ | ----- |
  | `ci.yml` (Build & Lint) | 20     | 24    |
  | `ci-integration.yml`    | 20     | 24    |
  | `compile-manifest.yml`  | 20     | 24    |
  | `lint.yml` (Totem Lint) | 22     | 24    |
  | `release-binary.yml`    | 22     | 24    |
  | `totem-doctor.yml`      | 22     | 24    |

  `release.yml` (the OIDC publish workflow) was already on Node 24 from [`mmnto-ai/totem#1991`](https://github.com/mmnto-ai/totem/pull/1991) and is unchanged.

  ## Cohort tightened to single Node floor

  Initial drafts of this PR landed `@mmnto/totem`, `@mmnto/pack-rust-architecture`, and `@mmnto/pack-agent-security` at `>=22` under the framing "library — allows Node 22 LTS consumers." That framing was aspirational — it presupposed downstream-isolated library consumers who consume `@mmnto/totem` outside the cli/mcp surface and need Node 22 LTS support. Cross-stream review with `strategy-claude` walked the candidate-load-bearing scenarios:

  | Scenario                                                                    | Status                                                                                                                               |
  | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
  | Cohort packages consume `@mmnto/totem` as a library on Node 22              | No — cohort consumption is via cli/mcp surface, both already `>=24`                                                                  |
  | External enterprise consumer on Node 22 LTS using `@mmnto/totem` standalone | None visible; not a tracked commitment in any current ADR or Proposal                                                                |
  | Aspirational future "publish-as-standalone-library" goal                    | Not in any current ADR / Proposal / accepted-status doc                                                                              |
  | LTS floor convention for npm publishing hygiene                             | Convention only — and conventions without test coverage are exactly the unanchored-claim pattern this PR's discipline argues against |

  CR + GCA review independently surfaced this gap (PR #2013 R1, `df1a141d`): "@mmnto/totem declares engines.node >= 22, but CI floor is now 24 across all jobs. The runtime APIs work down to 22 — that's an unanchored claim. No CI leg validates it." Two bots, independent path, same finding. Strong signal.

  Resolved by lifting all three `>=22` packages to `>=24`. Single cohort Node floor; declared compatibility now matches tested compatibility. If a standalone-library consumer on Node 22 LTS emerges later with concrete asks, lift the floor back to `>=22` AND add the Node 22 matrix leg at that point — don't pay CI complexity speculatively.

  ## Why this is a MINOR bump

  Adding a minimum-Node constraint is technically a breaking change for any consumer on an older Node version. Per cohort convention from prior 1.4x cycles, engines bumps ship as MINOR (additive constraint surfaced via the version bump) rather than MAJOR, since they don't change package API surface. Consumers pinned to `^1.x` and on a satisfying Node version are unaffected.

  ## Runtime-vs-build-tool note on release-binary.yml

  `release-binary.yml`'s Node 24 bump in this PR gates the `pnpm install --frozen-lockfile` step only — the Bun cross-compilation steps that follow are entirely independent of the Node version. Per CR R1 observation: the Node version does not affect binary output; it only gates the install step. Documented here so the CHANGELOG body for 1.48.0 carries the rationale.

  ## Defect-fix discovered during cherry-pick

  Original W3 checkpoint at `4dd5af79` (parked local) added a fresh `engines: { node: ">=22" }` block to `packages/pack-rust-architecture/package.json` without merging into the file's existing `engines: { "@mmnto/totem": "^1.26.0" }` block. Duplicate JSON keys are implementation-defined; pnpm/npm take the last occurrence, which would have silently dropped the `node` constraint. Empirical "test passed on Node 22" claim in the original checkpoint was masked by `@mmnto/cli`'s `>=24` failing first across the workspace.

  Fixed by merging the two engines blocks into one — single block, both `node` and `@mmnto/totem` fields (initially at `node: ">=22"`, later lifted to `">=24"` per § Cohort tightened to single Node floor above).

  ## Symmetric coverage on pack-agent-security

  Original W3 plan named 4 packages (cli, mcp, core, pack-rust). pack-agent-security has the same single-engines-block structure with `@mmnto/totem` constraint only, no `node` field. Included for symmetric workspace-install gate coverage; pack is `private: true` so no downstream consumer impact, but local dev workflows benefit from the engine-strict enforcement.

  ## Discipline-anchor exhibit (Tenet 4 working as advertised)

  This PR's R-walk surfaced two distinct `feedback_contract_claims_must_anchor_to_canonical_code` violations that the engine-strict mechanism caught in succession — the same mechanism this PR ships:
  1. **Initial push at `0fa16fdb`:** The changeset asserted `@mmnto/cli`'s `engines.node = ">=24"` "matches the CI runner pin from #1991." #1991 only bumped `release.yml` (publish workflow); the general CI was still on Node 20 or 22. Cross-platform CI failed loud with `ERR_PNPM_UNSUPPORTED_ENGINE` — the gate enforcing its own discipline on the PR author's anchor-claim violation. Fixed in `df1a141d` (bumped 6 workflows + corrected the changeset prose).
  2. **Post-fix at `df1a141d`:** CR + GCA independently converged on the same finding at a different altitude — declared support for `>=22` on `@mmnto/totem` + the two packs, while CI tested only on Node 24. Same anchor-claim pattern. Fixed in the follow-on commit by lifting all `>=22` packages to `>=24`.

  Both violations were caught — once by CI (engine-strict directly), once by bot R-walk (engine-strict's discipline-pattern applied to the next-altitude untested claim). The mechanism IS the safeguard. This is exactly the "Sensors fail loud and fast" pattern from `design-tenets.md` Tenet 4 working as advertised in a recursive way: the very gate being shipped enforced its own discipline on the PR's author at write-time.

  Banked as the N+1 anchor on `feedback_contract_claims_must_anchor_to_canonical_code` per cohort convention.

  ## Empirical verification
  - Active Node: `v24.16.0`
  - `pnpm install --frozen-lockfile` succeeds clean post-fix (all 5 `engines.node` constraints satisfied)
  - Parser verification confirms single `engines` block per package with expected fields

### Patch Changes

- @mmnto/totem@1.48.0

## 1.47.1

### Patch Changes

- 97e615a: chore(skills): fix 3 CR findings in canonical scaffold templates (lc#406 R1 deferral)

  Resolves the 3 CR findings on cohort canonical skill templates surfaced at [`mmnto-ai/liquid-city#406`](https://github.com/mmnto-ai/liquid-city/pull/406) R1, deferred upstream by `lc-claude` (correct call — applying locally would have diverged the LC copy from the cohort canonical and repeated the drift pattern that the scope-creep reversion just resolved).

  ## What ships

  All three fixes are content-only edits to the canonical scaffold templates in `packages/cli/src/commands/init-templates.ts`, mirrored into the locally-rendered copies at `.claude/skills/review-reply/SKILL.md` and `.claude/skills/signoff/SKILL.md`. No API change, no behavior change in the CLI itself.

  **Finding 1 (MAJOR) — review-reply skill, GCA-items bullet**

  Before:

  ```bash
  gh api `repos/{owner}/{repo}/issues/$ARGUMENTS/comments` --input -
  ```

  After:

  ```bash
  gh pr comment $ARGUMENTS --body-file -
  ```

  `{owner}/{repo}` are GitHub-REST-API-doc-style placeholders. They're fine when a human consults the docs and substitutes consciously — they're NOT fine in a SKILL.md template that's read by agents executing literally. The `gh pr comment` substitution removes the placeholder class entirely, drops the resolution boilerplate, and is portable (PRs ARE issues in GitHub's data model, so the same `gh pr comment` invocation handles both).

  **Finding 2 (MAJOR) — signoff skill, Visiting-case clause**

  Before: "...where `<your-home-agent-id>` is the agent-id from the row matching the repo you were last working in..."

  After: "...where `<your-home-agent-id>` is your own agent-id (e.g., a `strategy-claude` session always writes as `strategy-claude` regardless of which repo it's visiting...)..."

  The original phrasing read as temporal-state language ("which repo did I touch most recently?"); the actual semantic is identity-lookup ("you are `strategy-claude` regardless of where you're visiting"). The example in the same clause already implied the identity-semantic, but the lead wording invited the temporal-state misread.

  **Finding 3 (NITPICK) — signoff skill, Override-hook prose**

  Before: "Override hook: if the consuming repo carries `.totem/orchestration/config.json` with a `host_agents: string[]` field, prefer that list over the hardcoded map. Reserved for repos that legitimately host an agent not in the default map."

  After: "Override hook: if the consuming repo carries `.totem/orchestration/config.json` with a `host_agents: string[]` field, that list **replaces** the basename map's answer for this repo (precedence: `TOTEM_SELF_AGENT` env > config.json `host_agents` > hardcoded basename map). The returned list of agent-ids is used by consumers (e.g., `totem mail`) to filter cross-repo handoffs — messages addressed to any agent-id in the list belong to this repo's session. Reserved for repos that legitimately host an agent not in the default map — e.g., a custom-named cohort variant or an orphan-stream repo declaring itself as an agent host."

  Wording corrected against the actual runtime contract in [`packages/core/src/orchestration-resolver.ts:150-260`](https://github.com/mmnto-ai/totem/blob/main/packages/core/src/orchestration-resolver.ts) on two counts:
  1. The `host_agents` override **replaces** the basename map's answer (early-return at line 245), it does not augment a candidate set
  2. The resolver returns a **list** of agent-ids that consumers (e.g., `totem mail`) filter against — there is no per-agent-id selection step inside the resolver. CR's "selection semantics when multiple entries are present" framing was a category error against the actual contract; the corrected wording clarifies what the resolver does instead of inventing a selection rule that doesn't exist.

  ## Propagation

  These fixes land in the canonical scaffold source. They flow to cohort consumers via the next `totem init` cycle (or, post `--force-skill-refresh` once W3.5 ships, via explicit skill-refresh invocation).

  ## Cross-references
  - [`mmnto-ai/liquid-city#406`](https://github.com/mmnto-ai/liquid-city/pull/406) — LC consumer that surfaced the findings; CR R1 disposition will cross-link this PR
  - [`packages/core/src/orchestration-resolver.ts:150-260`](https://github.com/mmnto-ai/totem/blob/main/packages/core/src/orchestration-resolver.ts) — runtime source-of-truth for Finding 3 wording
  - @mmnto/totem@1.47.1

## 1.47.0

### Minor Changes

- 5997f78: fix(lint): narrow WWND claim-discipline scope to diff-touched files ([mmnto-ai/totem#2002](https://github.com/mmnto-ai/totem/issues/2002))

  Closes [mmnto-ai/totem#2002](https://github.com/mmnto-ai/totem/issues/2002). Adds a `--scope-to-diff` flag (and matching programmatic `changedFiles` option) so the standing-gate WWND scan narrows to files in the current push diff instead of walking every in-scope public surface unconditionally.

  ## What ships

  **New CLI flag:**

  ```bash
  totem doctor --claim-discipline --strict --scope-to-diff
  ```

  The pre-push hook generated by `totem hook install` now passes `--scope-to-diff` by default, so the gate only fires on WWND surfaces the operator's push actually modifies.

  **New programmatic option** on `doctorClaimDisciplineCommand`:

  ```typescript
  interface ClaimDisciplineOptions {
    /** posix-style, repo-root-relative — same shape as `git diff --name-only` */
    changedFiles?: readonly string[];
  }
  ```

  When `changedFiles` is `undefined`, the existing standing-gate behavior is preserved (full surface scan). When provided, the in-scope file list is narrowed to the intersection of `(WWND surface walk)` AND `changedFiles`.

  ## Diff-resolution semantics

  The CLI flag resolves the diff range as:
  1. `git merge-base HEAD @{upstream}` (preferred — the normal pre-push state)
  2. `HEAD~1` (fallback — fresh branch with no upstream)
  3. Warn and fall back to standing-gate full scan (detached HEAD with no parent + no upstream)

  Diff filter `--diff-filter=ACMR` covers Added/Copied/Modified/Renamed; Deleted files are excluded because a deleted file can't trigger a WWND match.

  ## Why scope-narrowing, not allowlist

  Rationale: N=8 false-positive bypasses in <24hr on the pre-existing warning at `docs/wiki/governing-ai-agents.md:58` while pushing diffs that didn't touch that file. An allowlist would paper over the scope bug (gate keeps scanning files the operator didn't change); diff-scope narrowing fixes the scope itself without weakening the gate's surface set.

  The standing-gate full scan still runs when `--scope-to-diff` is absent — useful for CI sweeps, audit runs, and the case where diff resolution fails entirely.

### Patch Changes

- @mmnto/totem@1.47.0

## 1.46.0

### Minor Changes

- e3d87ea: feat(cli): `--ast-parse-mode lenient` operator escape for AST parse failures ([mmnto-ai/totem#1982](https://github.com/mmnto-ai/totem/issues/1982))

  Closes [mmnto-ai/totem#1982](https://github.com/mmnto-ai/totem/issues/1982). Mirrors the existing `--timeout-mode lenient` precedent at `packages/cli/src/commands/lint.ts` for a different failure class: AST parse errors that currently abort the entire lint run (e.g. `ast-grep batch parse failed: rust is not supported in napi` on Windows).

  Empirical trigger: `mmnto-ai/liquid-city#348` (Bevy 0.14 → 0.18.1) hit the napi-unsupported-Rust parse failure on every changed Rust file, blocking pre-push with no audited escape route (`--no-verify` violates AGENTS.md spirit).

  ## What ships

  **New CLI flag:**

  ```bash
  totem lint --ast-parse-mode lenient
  ```

  **Env var equivalent (session-level escape, usable in pre-push hooks):**

  ```bash
  TOTEM_LINT_AST_PARSE_MODE=lenient totem lint
  ```

  Precedence: CLI flag > env var > default `'strict'`.

  **`'lenient'`** captures the parse failure into a new `AstParseFailureOutcome` array, logs a warning naming the affected language, sets `astViolations = []`, and continues with regex results. **`'strict'`** (default) preserves the current hard-fail behavior.

  **Diagnostic hint upgrade in `@mmnto/totem`:** `AST_GREP_HINT` (surfaced via every `TotemParseError`'s `recoveryHint`) now names the new escape route and cross-refs [mmnto-ai/totem#1786](https://github.com/mmnto-ai/totem/issues/1786) for the durable per-file degrade fix.

  ## Semantic asymmetry vs `--timeout-mode lenient` (deliberately documented)

  | Flag                       | Skip granularity                                         | Why                                                                                                                                                                               |
  | -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `--timeout-mode lenient`   | **per-rule** (per rule-file pair that times out)         | Bounded evaluator captures timeouts in-loop without throwing                                                                                                                      |
  | `--ast-parse-mode lenient` | **run-wide** (skip ALL AST rules on first parse failure) | AST batch parser raises `TotemParseError` that escapes the per-file loop in core; per-file degrade is [mmnto-ai/totem#1786](https://github.com/mmnto-ai/totem/issues/1786)'s lane |

  For the current trigger (napi unsupported language), per-file vs run-wide is operationally equivalent — every Rust file fails parse the same way. The asymmetry matters when future mixed-language scenarios surface (e.g. Python parses, Rust doesn't); that's `#1786`'s design space, not this scope.

  ## Telemetry / programmatic access

  `runCompiledRules()` now returns `astParseFailures: AstParseFailureOutcome[]` alongside `regexTimeouts`:

  ```typescript
  interface AstParseFailureOutcome {
    file: string; // '*' (run-wide; per-file granularity is #1786)
    language: string; // 'rust' or 'unknown' if not parseable from msg
    message: string; // first 200 chars of sanitized parser-error text
    mode: 'lenient';
  }
  ```

  Parser-error text is sanitized via the canonical `sanitizeForTerminal()` helper from `@mmnto/totem` core (`packages/core/src/terminal-sanitize.ts`) before logging or persisting. Strips CSI/ANSI escapes, C0 controls (including bare CR per CR [mmnto-ai/totem#1739](https://github.com/mmnto-ai/totem/issues/1739) R3 — cursor-rewind spoofing), and C1 controls (`\x80-\x9F`). Preserves TAB and LF. Defends against terminal injection from ast-grep's parsed-content snippets.

### Patch Changes

- Updated dependencies [e3d87ea]
  - @mmnto/totem@1.46.0

## 1.45.0

### Minor Changes

- 388dd95: feat(cli+core): Proposal 281 per-lesson compile cache (incremental compilation) (#1983)

  Implements [Proposal 281 (Per-Lesson Hash Stability)](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/accepted/281-per-lesson-hash-stability.md), accepted via [`mmnto-ai/totem-strategy#387`](https://github.com/mmnto-ai/totem-strategy/pull/387) on 2026-05-20. Closes the first of two freeze-lift gates for `project_rule_compilation_freeze_2026_05_17` (Path A per [ADR-108](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-108-agent-state-continuity-architecture-synthesis.md)).

  A per-lesson cache keyed by `(sourceHash, compile_worker_fingerprint)` short-circuits `totem lesson compile` for lessons whose source content is unchanged. Result: a `+1` lesson PR produces a `compiled-rules.json` diff with 1 new row, not 4931 lines.

  ## Surfaces
  - `packages/core/src/compile-cache.ts` — new module: `CacheEntrySchema` (with `stableId?: string` reserved for P280 per [`mmnto-ai/totem-strategy#387`](https://github.com/mmnto-ai/totem-strategy/pull/387) § Dependencies), `computeLessonSourceHash`, `lookupCacheEntry`, `writeCacheEntry`, `buildCacheEntry`, `migrateFromCompiledRules`, `cacheEntryPath`, `listCacheEntries`.
  - `packages/core/src/compile-cache.test.ts` — 21 tests covering the partial-mutation invariant (falsifying-metric test), byte-for-byte preservation on hit, fingerprint-rotation invalidation, source-change invalidation, `--force` bypass, `stableId` slot round-trip, graceful-miss on malformed cache files, `TOTEM_DISABLE_COMPILE_CACHE` env-var escape hatch, and migration idempotence.
  - `packages/core/src/ledger.ts` — `LedgerEventSchema.type` enum extended with `compile_cache_decision`. `ruleId` carries the lesson `sourceHash`; `activity_name` carries the decision enum value (`cache_hit` / `cache_miss_source_changed` / `cache_miss_fingerprint_changed` / `cache_miss_force` / `cache_miss_no_prior_record`).
  - `packages/cli/src/commands/compile.ts` — parallel compile path (~line 1614) wrapped with cache lookup. Cache hit returns the stored `CompileLessonResult` verbatim; cache miss invokes `compileLessonCore` and persists the result. `options.force` and `upgradeTargets` are honored as forced-recompile signals. Cache is bypassed when `compile_worker_fingerprint` is `undefined` (matching the `verify-manifest` provider gap discipline).

  ## Cache key composition

  Layered (not composite). `stableId` first when present (P280 reservation; v1 never writes it) → `sourceHash` (SHA-256 of normalized lesson source, line endings collapsed to `\n`) → `fingerprint` (exact match required, else miss). `cli_version` is intentionally absent from the key — including it would invalidate every cohort bump.

  ## Storage

  `.totem/cache/compile-lesson/<sourceHash-first-16-chars>.json`. Already gitignored (`.gitignore:5`). Flat directory for v1; fan-out follow-on tracked post-PR-open with soft trigger 1000 lessons.

  ## Telemetry

  `compile_cache_decision` event per lesson per compile run. Best-effort fire-and-forget; ledger-write failures are swallowed at the writer site so a degraded ledger does not block compile.

  ## Emergency escape

  `TOTEM_DISABLE_COMPILE_CACHE=1` reverts cache behavior to the pre-#1983 status quo (lookup returns no-prior-record, write becomes a no-op). Emergency-only; deprecation-watch tracked post-PR-open.

  ## Falsifying metric

  Per [Proposal 281 § Falsifying Metric](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/accepted/281-per-lesson-hash-stability.md): ≥99% of compile runs touching K lessons (by source change) produce `compiled-rules.json` row changes for exactly K lessons. Window: event-count-bounded (N=20 PRs post-thaw).

  ## Sequencing

  P281 ships first (per [`mmnto-ai/totem-strategy#387`](https://github.com/mmnto-ai/totem-strategy/pull/387) re-grounded shape + ADR-108 Path A). P280 (`stableId` on lesson frontmatter) follows as defense-in-depth — the reserved `stableId` slot in `CacheEntry` makes P280's arrival additive, not breaking. The rule-compilation freeze lifts after both gates close + end-to-end clean recompile passes.

### Patch Changes

- Updated dependencies [388dd95]
  - @mmnto/totem@1.45.0

## 1.44.0

### Minor Changes

- c0f0cfc: feat(cli+core): `totem mail` cross-repo outbox poll subcommand (mmnto-ai/totem#1970)

  Closes [mmnto-ai/totem#1970](https://github.com/mmnto-ai/totem/issues/1970). Option B locked per [ADR-107](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-107-ecl-canonical-over-a2a.md) (Ephemeral Coordination Layer canonical; no network-RPC alternative adopted).

  New `totem mail` subcommand surfaces unread mail addressed to this repo's agent(s) by scanning sibling-repo outboxes per [ADR-106 § 3](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-106-ephemeral-coordination-layer.md). Provides the first canonical implementation of the spec so consumer repos (`totem`, `liquid-city`, `arhgap11`, `totem-status`, etc.) pick the poll up via cohort sync rather than each maintaining its own copy. Before this, only `mmnto-ai/totem-strategy` had a working poll (the reference impl in its SessionStart hook); other cohort repos had no implementation at all.

  Empirically motivated: two outbound handoffs from `strategy-claude` (`2026-05-18T1734Z` → `totem-claude`; `2026-05-18T1918Z` → `lc-claude`) sat undelivered for ~30-36h despite valid `to:` frontmatter because [ADR-106 § 3](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-106-ephemeral-coordination-layer.md) specified the cross-repo outbox-poll mechanism but no recipient repo's hook implemented it. The strategy-side reference implementation ([`mmnto-ai/totem-strategy#373`](https://github.com/mmnto-ai/totem-strategy/pull/373), merged at `ea0ee6d`) validated the behavior contract; this PR is the canonical port.

  ## Surfaces
  - **`packages/core/src/orchestration-resolver.ts`** — new `resolveSelfAgents(repoRoot, env?)` helper with the cohort agent-id map plus a 3-layer precedence chain (`TOTEM_SELF_AGENT` env > `.totem/orchestration/config.json` `host_agents` > basename map > `[]`). Mirrors `resolveOrchestrationPaths`'s path-traversal guard so a malicious or buggy `host_agents` entry drops at the validation boundary instead of escaping `.totem/orchestration/`.
  - **`packages/cli/src/commands/mail.ts`** — `pollMail()` programmatic entry returning a structured `MailPollResult` plus `mailCommand()` CLI wrapper. Reusable by hooks (JSON output), MCP audit tools, and future surfaces.
  - **`packages/cli/src/index.ts`** — `totem mail [--json] [--recursive] [--workspace <path>]` registration alongside the existing administrative subcommands.

  ## Behavior contract (locked per ADR-107 § Consequences)
  - **Match**: case-insensitive on `to:` frontmatter value against the SELF_AGENT set or literal `broadcast`. Required for back-compat with the existing `to: arhgap11-Gemini` capitalization in an outbox file.
  - **Exclude**: files whose basename appears in any SELF_AGENT's `processed/` or `processed/_broadcast/` directory.
  - **Workspace**: parent directory of `repoRoot` by default; `TOTEM_WORKSPACE` env var or `--workspace` flag override.
  - **Recursive**: opt-in via `--recursive` flag. The default scans `<workspace>/*/.totem/orchestration/*/outbox/*.md`; recursive descends up to 6 levels skipping dot-dirs and `node_modules`.
  - **Latency cap**: `MAX_SCAN=500` files scanned per invocation. When tripped, result carries `truncated: true` so the caller can surface the warning instead of silently dropping mail.
  - **Sort**: newest-first by frontmatter `date:` with filename fallback.
  - **Frontmatter safety**: only the header block (text before the first blank line) is parsed for `to:` / `from:` / `subject:` / `date:`. Body lines starting with `to:` cannot fabricate a match or overwrite displayed metadata.
  - **Failure stance**: never throws on filesystem failure; degrades to warnings on the result so a degraded workspace state does not block the poll.

  ## Tests
  - 23 new resolver tests cover the basename map for every cohort repo, `host_agents` override precedence, `TOTEM_SELF_AGENT` env precedence, comma-separated list parsing, path-traversal rejection at every layer, malformed JSON tolerance, and `path.resolve` normalization on relative inputs.
  - 29 new mail-command tests cover basic filter behavior, broadcast handling, processed/ + processed/\_broadcast/ exclusion, multi-agent repo behavior, newest-first sort, CRLF line endings, frontmatter-header restriction (body forge attempt), workspace + recursive options, `node_modules` skip, and `MAX_SCAN` truncation.
  - Smoke-tested against the live cohort workspace: surfaces the three handoffs currently addressed to `totem-claude` in `mmnto-ai/totem-strategy:.totem/orchestration/strategy-claude/outbox/`.

  ## SELF_AGENT resolution rationale (`mmnto-ai/totem#1970` Q1)

  The signoff skill at `.claude/skills/signoff/SKILL.md` already names the resolution mechanism in prose (basename → agent-id table + `.totem/orchestration/config.json` `host_agents` override). Encoding that prose into a reusable helper rather than re-deriving in each consumer is the path Tenet 15 (Axiom Mandate) implies: encode as mechanism, not prose. The env-var precedence is the hook surface — hooks set `TOTEM_SELF_AGENT` to declare identity when running inside a CI/test/visiting context where the basename heuristic does not apply.

  ## Consumer migration (not in this PR)

  Once this lands and cohort-propagates, the strategy-side `pollInboundOutboxes` reference impl in [`mmnto-ai/totem-strategy:.claude/hooks/SessionStart.cjs`](https://github.com/mmnto-ai/totem-strategy/blob/main/.claude/hooks/SessionStart.cjs) is superseded — each consumer's hook can `exec totem mail --json` and inject the structured result. Per-vendor handling stays in the hooks themselves; the poll body is identical. Strategy-Claude has flagged the consumer-side cutover for cohort-sync after this ships.

### Patch Changes

- Updated dependencies [c0f0cfc]
  - @mmnto/totem@1.44.0

## 1.43.6

### Patch Changes

- 22b0b73: docs(skills): add visiting-Claude/Gemini fallback to /signoff (mmnto-ai/totem#1966)

  Closes [mmnto-ai/totem#1966](https://github.com/mmnto-ai/totem/issues/1966).

  The post-Proposal-282 `/signoff` skill resolves a journal write path via a hardcoded agent-id map, but the map carries two rows that lack a Claude variant: `totem-status` (`_(no Claude variant)_`) and `totem-playground` (`_(orphan stream — no native agent)_`). A Claude session visiting one of those repos (e.g., `strategy-claude` hopping over to inspect the dashboard) and invoking `/signoff` would hit a dead end — no agent-id, no journal path, no fallback. The same gap exists in the Gemini parity skill for `totem-playground`.

  The fix is a "visiting case" paragraph in step 2a of both skill bodies: when the row's vendor column is empty for the visiting agent, write to `<repoRoot>/.totem/orchestration/<your-home-agent-id>/journal/` — i.e., the visiting agent records its session under its own home agent-id within the host repo's orchestration tree. The host doesn't need a native variant to be a valid write target; the journal is for the visitor's state, not the host's.

  Surfaces updated symmetrically:
  - `mmnto-ai/totem:.claude/skills/signoff/SKILL.md` — canonical Claude skill
  - `mmnto-ai/totem:.gemini/skills/signoff.md` — Gemini parity
  - `mmnto-ai/totem:packages/cli/src/commands/init-templates.ts:SIGNOFF_SKILL_CONTENT` — `totem init` template (kept byte-identical to the canonical via `installed-skills-match-source.test.ts`)

  Strategy-Claude propagates the consumer-side drift fix in a separate pass on consumer repos (`mmnto-ai/totem-strategy#363` style). Option 1 from the ticket — visiting fallback in canonical — chosen over option 2 (remove the Claude skill from `totem-status`) because option 1 is cohort-portable: it addresses both `totem-status` and the orphan-stream `totem-playground` case with the same paragraph, where option 2 would only help one repo.
  - @mmnto/totem@1.43.6

## 1.43.5

### Patch Changes

- 4d47cff: fix(cli): isolate `review-alias.test.ts` spawn cwd from the real repo (mmnto-ai/totem#1942)

  Closes [mmnto-ai/totem#1942](https://github.com/mmnto-ai/totem/issues/1942).

  The `shield alias emits deprecation warning` test previously spawned `node dist/index.js shield` with `cwd: process.cwd()` — a path inside the real repo. The spawned process ran `shieldCommand`, which silently calls `upgradePrePushHookIfNeeded(process.cwd())`; that resolved the real git root and rewrote the developer's `.git/hooks/pre-push` from the legacy format to the stateless format mid-test. When `git push` was the calling context (the legacy pre-push hook runs `pnpm run test`, which forked the offending test), bash reported a syntax error against a line whose content matched a different line — the canonical mid-parse-rewrite tell.

  The spawn now uses a fresh `os.mkdtempSync` directory under `os.tmpdir()` as its cwd, so `resolveGitRoot` returns `null` and the upgrader short-circuits before writing.

  A new vitest `globalSetup` (`packages/cli/vitest.global-setup.ts`) snapshots `.git/hooks/pre-push` at run start and asserts byte-identity at teardown — a future test that introduces the same isolation defect fails with surface-area and remediation guidance inline. The check is coarse (one snapshot per run, not per test) and cheap.

  Production behavior of `upgradePrePushHookIfNeeded` is unchanged. The 11 additional test files that the original investigation comment flagged as mutators were cross-worker contamination artifacts — parallel workers snapshotted the pre-mutation hash in `beforeEach`, then observed the post-mutation hash in `afterEach` because `review-alias.test.ts` had written to the shared real file mid-run. Running each in isolation against the legacy-format hook confirmed only `review-alias.test.ts` writes.
  - @mmnto/totem@1.43.5

## 1.43.4

### Patch Changes

- ac16fc3: feat(cli): add `verify-lockfile-sync` pre-push gate (mmnto-ai/totem#1961)

  Closes [mmnto-ai/totem#1961](https://github.com/mmnto-ai/totem/issues/1961).

  New deterministic pre-push check that blocks pushes containing `package.json` dependency-pin additions when `pnpm-lock.yaml` is tracked but missing from the same diff range. Catches the cohort-sync failure pattern where a caret bump in `package.json` lands without a regenerated lockfile and CI's `pnpm install --frozen-lockfile` rejects it ~3 minutes later — recorded N=4 across the cohort, including `mmnto-ai/liquid-city#225/#248/#289/#357`.

  The gate is invoked from the generated pre-push hook script (`buildPrePushHook` in `install-hooks.ts`), slotted before the WWND claim-discipline gate so the mechanical fast-fail runs before the slower prose-discipline walk. The check is conditioned on `pnpm-lock.yaml` existing in the working tree, so consumers using a different package manager are unaffected.

  Implementation notes:
  - `packages/cli/src/commands/verify-lockfile-sync.ts` — pure function `verifyLockfileSyncCommand()` returning a `{ valid, reason? }` result, plus `verifyLockfileSyncCliCommand()` throwing `TotemError` for the CLI surface. Mirrors the `verify-badges.ts` shape.
  - Best-effort fall-through on git failures (lockfile not tracked, no remote, detached HEAD, missing refs) — matches the carve-out at `verify-manifest.ts:127-131` so a degraded git state does not block legitimate pushes.
  - Regex `/^\+\s*"(?!version")[^"]+"\s*:\s*"[\^~]?\d+\.\d+/m` excludes the package's own `"version"` field (false-positive class on Version Packages release commits where the lockfile happens to be absent from a partial diff), `workspace:^` references, and bare integer values like `"node": "20"` in `engines` blocks.
  - No bypass flag. The fix is mechanical (`pnpm install`); a bypass invites the exact drift the gate exists to prevent. The standard `git push --no-verify` escape hatch remains available but is explicitly banned in AGENTS.md.

  Encodes the rule body of `feedback_strategy_claude_canonical_cohort_sync` from prose-memory (which has reliably failed to self-activate across N=4 cycles) into mechanism, per Tenet 15 (Axiom Mandate — encode as mechanism, not prose).
  - @mmnto/totem@1.43.4

## 1.43.3

### Patch Changes

- d390c85: docs(cli): replace retired active_work.md hint in init-templates Start-of-Session ritual

  Closes [mmnto-ai/totem#1948](https://github.com/mmnto-ai/totem/issues/1948). Tier-3 follow-up from [mmnto-ai/totem#1945](https://github.com/mmnto-ai/totem/pull/1945) (which removed the "Read `docs/active_work.md` for momentum" line as part of the broader retirement of `docs/active_work.md` as a project-wide convention).

  The scaffolded **Start of Session** ritual at `AI_PROMPT_BLOCK` now points new projects at the MCP `describe_project` tool for richer derived project state — recent merged PRs, current branch + uncommitted files, latest strategy journal pointer, package versions, rule/lesson counts — sourced from git + filesystem state instead of a hand-maintained file. Aligns with Proposal 264 / Proposal 282 doctrine: state is observed, not declared.

  Direction-2 framing from the issue, anchored to a shipped surface (these fields are all derived by `packages/mcp/src/state-extractors.ts` today) rather than the unshipped `totem status --json` v0.2 fields. Deliberately excludes `milestoneState` / gate-tickets from the hint — `extractMilestoneState` still parses the retired `docs/active_work.md` and returns null in steady state; broader cleanup tracked at [mmnto-ai/totem#1947](https://github.com/mmnto-ai/totem/issues/1947). Cloud bots and local CLI agents both have MCP access; portable.

  `REFLEX_VERSION` bumped from 5 to 6 so existing projects' next `totem init` pass detects the stale block and offers an upgrade.
  - @mmnto/totem@1.43.3

## 1.43.2

### Patch Changes

- 9549c15: fix(core): harden resolveOrchestrationPaths with path.resolve(repoRoot) — match resolveSubstratePaths absolute-output guarantee

  Closes [mmnto-ai/totem#1953](https://github.com/mmnto-ai/totem/issues/1953). Tier-1 follow-up from the GCA review on [mmnto-ai/totem#1952](https://github.com/mmnto-ai/totem/pull/1952) (Phase 4 PR C changeset).

  `resolveOrchestrationPaths` (`packages/core/src/orchestration-resolver.ts`) previously trusted the JSDoc contract that callers supply an absolute `repoRoot`. A caller violating the contract by passing a relative path would get relative `outbox` / `processed` / `journal` paths back — a quiet correctness slip rather than a loud error. `resolveSubstratePaths` runs `path.resolve(configRoot)` on its input for the same reason; symmetric absolute-output behavior is restored here.

  One-line fix: `const resolvedRoot = path.resolve(repoRoot);` applied before composition, sibling to the existing path-traversal guard. Plus one new test confirming relative `repoRoot` input produces absolute output (parity with the substrate-resolver path-shape contract). 19 resolver tests green.

- Updated dependencies [9549c15]
  - @mmnto/totem@1.43.2

## 1.43.1

### Patch Changes

- 5d96b99: feat(core+mcp+skills): orchestration resolver + extractor swap + signoff skill (Proposal 282 / ADR-106 Phase 4 PR A)

  Ships the totem-Claude impl-lane slice of [mmnto-ai/totem-strategy#341](https://github.com/mmnto-ai/totem-strategy/pull/341) (Proposal 282 — Local-Only Orchestration, accepted) per the Phase 4 dispatch at `mmnto-ai/totem-substrate:.handoff/totem-claude/processed/2026-05-17T0929Z-strategy-claude.md`. Substrate stays mounted as a frozen archive for forensic reads; new inter-agent coordination flows through per-repo paths.

  **New `@mmnto/totem` exports:** `resolveOrchestrationPaths` and the `OrchestrationPaths` discriminated-union type. The resolver returns `{ outbox, processed, journal, source }` for a given `(repoRoot, agentId)`, where each path field is the path to that subdir or `null` when it doesn't exist. Per the JSDoc contract, `repoRoot` is supplied absolute (callers resolve via `resolveStrategyRoot` / `resolveGitRoot` / `process.cwd()` upstream). `source: 'orchestration' | 'none'` is the precedence-chain signal — orchestration when at least one subdir exists, none otherwise. Same purity stance as `resolveStrategyRoot` / `resolveSubstratePaths`: no caching, no side effects, no logging.

  **Additive sibling.** `resolveSubstratePaths` stays live for frozen-archive reads; the two resolvers run in parallel through and after the cohort cutover so downstream consumers can migrate independently. No removal of substrate-resolver code in Phase 4.

  **Path-traversal guard.** `resolveOrchestrationPaths` validates `agentId` against `/[/\\\0]|\.\./` before composing the base path. The hardcoded map in the `/signoff` skill is safe, but the `.totem/orchestration/config.json` `host_agents` override is repo-controlled input; a malicious or buggy override (`'..', '../..', 'a/b'`) would otherwise escape `.totem/orchestration/` after `path.normalize` collapses `..` segments. Invalid input returns `source: 'none'` with all paths null — same shape as a missing tree, callers already tolerate that branch.

  **`@mmnto/mcp` extractor swap.** `extractStrategyPointer` now reads orchestration first (the active write target post-Phase-2 migration), falling back to substrate when orchestration is empty across both strategy agents (frozen-archive layer for historical journals). Cross-agent merge uses hybrid sort: filename within an agent's directory (same `<model>-NNNN-*` prefix is monotonic by session counter, cheap), then mtime tiebreak across agents on each agent's latest. The naive alphabetical sort across `claude-*`/`gemini-*` prefixes always puts gemini last regardless of write time and was caught by local shield review pre-merge.

  **`@mmnto/cli` signoff skill.** `SIGNOFF_SKILL_CONTENT` in `init-templates.ts` rewrites the procedure for post-Proposal-282 reality: hardcoded agent-id map (cohort-wide; override hook via `.totem/orchestration/config.json` `host_agents`), `resolveOrchestrationPaths` path discovery, null-source manual-mkdir prose, gitignore-aware no-commit/no-push flow. Source-of-truth for the skill is `.claude/skills/signoff/SKILL.md` with the `installed-skills-match-source.test.ts` invariant locking template content against the source file.

  **Tests.** Resolver: 18 tests covering presence permutations (none / partial / full / multi-agent / cross-repo), path normalization, file-in-place-of-subdir, and 6 agentId validation cases (empty / `..` / `/` / `\\` / null byte / non-string). State-extractor: 7 new tests covering orchestration-vs-substrate precedence, single-agent-only, both-agents-populated mtime semantics, and cross-agent mtime tiebreak. Full sweep: 1976 `@mmnto/totem` + 151 `@mmnto/mcp` + 2192 `@mmnto/cli` tests green.

  **Sequencing.** Phase 4 PR A is the first of three: PR A (this — bundled impl) → PR B (`mmnto-ai/totem-status` dashboard repoint, Go side) → PR C (cohort version bump). The cutover broadcast (last substrate write) is strategy-Claude's lane gated on all three landing.

- Updated dependencies [5d96b99]
  - @mmnto/totem@1.43.1

## 1.43.0

### Minor Changes

- c0c4496: feat(cli+core): WWND Claim-Discipline Gate infrastructure + Rule 1 — `totem doctor --claim-discipline` (Proposal 279 PR α)

  Ships the infrastructure half of [mmnto-ai/totem-strategy#338](https://github.com/mmnto-ai/totem-strategy/pull/338) (Proposal 279 — WWND Claim-Discipline Gate, merged at `670b635a`). Rules 2-5 + calibration land in PR β per the cross-stream two-PR shape decided at [2026-05-16T20:35Z](https://github.com/mmnto-ai/totem-substrate/blob/main/.handoff/totem-claude/processed/2026-05-16T2035Z-strategy-claude.md).

  **Three additions to `LedgerEventSchema`:**
  - `claim_discipline_finding` joins the activity-event z.enum sibling family. Emitted by `totem doctor --claim-discipline` when a WWND rule fires on a public-surface diff; `ruleId` carries the WWND rule hash and `activity_name` carries the surface (README.md / AGENTS.md / design-tenets.md / docs/wiki).
  - `cli_version` — optional string field carrying the `@mmnto/cli` semver that produced the event. Useful for correlating gate behavior with releases. Available to all activity events, not just claim-discipline.
  - `addressed_in_pr` — optional boolean recording whether a `claim_discipline_finding` was addressed inside the same PR that introduced it. Computed at merge time by post-merge replay against the PR-body justification heading.

  All schema changes are additive — no migration cost for existing manifests or ledgers. Promotion to `z.discriminatedUnion` stays deferred to A.3.c per the existing OQ-1 comment.

  **New `@mmnto/totem` error code:** `CLAIM_DISCIPLINE_FAILED` joins `TotemErrorCode`.

  **New `totem doctor --claim-discipline` subcommand.** Sibling to `--compliance` (queued for A.3.b). Three modes:
  1. **Default** — surfaces all findings via log.warn / log.error; gate passes unless an `error`-severity finding fires.
  2. **`--strict`** — promotes `warning`-severity findings to gate failures. The pre-push hook invokes `--claim-discipline --strict` per Proposal 279 Q3.
  3. **`TOTEM_GATE_BYPASS_JUSTIFICATION` env var** — non-empty value records the justification on emitted ledger events and passes the gate regardless of finding severity. Standardized cohort-wide convention from Proposal 279 Q3, mirroring `TOTEM_DRIFT_JUSTIFICATION` from [mmnto-ai/totem#1939](https://github.com/mmnto-ai/totem/pull/1939).

  **Discovery convention:** WWND rules are recognized by their `lessonHeading` starting with `"WWND Rule "`. Filename-based discovery (`.totem/lessons/wwnd-*.md`) was considered but adds a two-pass walk; heading-prefix lookup is one-pass against the already-loaded rule set.

  **In-scope surfaces:** README.md, AGENTS.md, design-tenets.md (literal, existence-gated), plus recursive walk of `docs/wiki/**` for `.md` files. The recursive walk is a ~10-line zero-dep alternative to the glob package; full glob support deferred to PR β when it becomes load-bearing.

  **Pre-push hook integration.** Slot 6 in the existing pre-push sequence, after `verify-badges`. Fires only when at least one in-scope surface exists. Bypass: `TOTEM_GATE_BYPASS_JUSTIFICATION="<reason>" git push`.

  **Rule 1 (Absolute-promise detection)** lands as a Pipeline 1 lesson with inline regex pattern from Proposal 279 § Scope:

  ```regex
  \b(?:[Ww]ill\s+(?:stay|remain|always\s+be|never\s+(?:change|move))|
      [Ww]on['']t\s+(?:change|ever)|
      [Gg]uarantees|
      [Pp]romises\s+to)\b
  ```

  Severity: `warning`. Scope: README.md, AGENTS.md, design-tenets.md, and `docs/wiki/` (recursive). Mechanizes Tenet 19 § How to apply item 4 (covenant claims must name structural backing or soften to present-tense intent). Empirical seed corpus: N=4 within 24h on 2026-05-15 (mmnto-ai/totem#1925, #1932, #1933), all caught post-merge by external review.

  Compiles via Pipeline 1 (manual regex, zero LLM call) per the A3 hybrid rule-authoring criterion: when the proposal specifies the exact pattern, the rule lands deterministic and the lesson documents the pattern post-hoc.

  **Compile Drift Justification.** The Pipeline 1 add for Rule 1 triggered known compile-corpus drift on 130 sibling rule hashes (lesson sources unchanged; only `lessonHash` rotated). This is the corpus-drift class named in [Proposal 278 § Action 4](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/active/278-compile-worker-determinism-interim-policy.md) (mmnto-ai/totem#1938) and Proposal 281 (axis-4, strategy-Claude drafting in parallel). The new compile output is internally consistent: `verify-manifest` passes (482 rules, hashes match). The drift gate is operating as designed — registering the rotation rather than preventing it (prevention requires axis-4 proposalization, deferred). The `.coderabbit.yaml` exclusion for `.totem/compiled-rules.json` landed in the first commit so bot review focuses on the meaningful change surface.

  **Empirical bonus** from smoke-testing the subcommand: it surfaced 1 pre-existing absolute-promise match in `docs/wiki/governing-ai-agents.md:58`. The gate is already doing useful work. Addressing or accepting the finding is out of scope for PR α; surfacing it is the load-bearing demonstration.

  **Tests:** 23 new tests (6 schema, 13 subcommand, 4 hook content); full suite 2192/2192 passing.

  **Out of scope (PR β):** Rule 2 (marketing-absolutes — direct + retro-lesson), Rules 3-5 (missing-Goal-prefix, falsifying-metric on ADRs, covenant-without-backing — all lesson→compile per the hybrid criterion), four-week calibration window start, false-positive shavings against the empirical N=5 corpus, ast/ast-grep engine dispatch in the scanner.

### Patch Changes

- Updated dependencies [c0c4496]
  - @mmnto/totem@1.43.0

## 1.42.0

### Minor Changes

- 14fbb74: feat(cli+core): `compile_worker_fingerprint` producer attestation + `verify-manifest` drift gate (Proposal 278 § Action 3 Phase 1)

  Ships the implementation slice of [mmnto-ai/totem-strategy#335](https://github.com/mmnto-ai/totem-strategy/pull/335) (Proposal 278 — Compile-Worker Determinism Interim Policy). Phase 1 scope is the anthropic-direct provider only; shell-orchestrator capture is a Phase 2 follow-on that does not gate this merge.

  **New manifest field.** `CompileManifestSchema` gains an optional `compile_worker_fingerprint: string` sibling to the existing `model` field. The fingerprint is `sha256(canonicalStringify({model, temperature?, seed?, promptTemplateContentHash}))` — `canonicalStringify` drops undefined keys, so the fingerprint records _absence_ (omits the slot) when the configured model rejects a sampling parameter rather than encoding a placeholder. Pre-#1937 manifests parse unchanged (field is optional).

  **New `@mmnto/totem` exports:** `computeCompileWorkerFingerprint`, `modelStripsTemperature`, `readPromptTemplateContentHash`, plus the `CompileWorkerFingerprintInputs` type. The `compile_run` event type joins the LedgerEventSchema enum.

  **Capture in `totem compile`.** When `config.orchestrator.provider === 'anthropic'`, both manifest-write sites (post-prune at compile.ts:1195 and full-recompile at :1739) populate the fingerprint. Other providers leave it undefined; `verify-manifest` drift surveillance is a no-op when either side is undefined. The `--refresh-manifest` path (compile.ts:814) preserves the existing fingerprint — refresh is provenance-preserving by design; `output_hash` and `compile_worker_fingerprint` are orthogonal axes (recompute trigger vs. worker attestation). Each compile-worker invocation also emits a `compile_run` event to the Trap Ledger (`source: 'lint'`, `activity_name: <provider>`); fire-and-forget per A.3.a writer contract.

  **Drift gate in `totem verify-manifest`.** After the existing input/output hash checks, the command reads the base `compile_worker_fingerprint` via `git show origin/main:.totem/compile-manifest.json` (falling back to local `main` when `origin/main` is unreachable, e.g. fresh clone) and compares. When the fingerprints differ AND `packages/cli/src/commands/compile-templates.ts` is NOT in the branch diff (`git diff main...HEAD --name-only`), the command fails with a recovery hint. The check is best-effort on origin/main lookup: when the remote ref is unreachable, the drift check no-ops rather than blocking — verify-manifest's existing hash gates still apply.

  **`--allow-compile-drift` override flag.** Bypasses the drift gate with mandatory articulation. Two enforcement paths:
  1. **CI (PR body available via `gh pr view --json body`):** requires a `## Compile Drift Justification` heading in the PR body. The heading is the binding accountability surface at merge time.
  2. **Pre-push (no open PR):** requires the `TOTEM_DRIFT_JUSTIFICATION` env var to be set non-empty. Contents are not validated — the act of typing the justification is the forcing function. Per Proposal 278 § Q3 fortification.

  **Intent-not-reality (Tenet 19).** The fingerprint reflects what the worker is _configured_ to send, not what the API _accepts_. For Opus 4.7+ (per `docs/reference/supported-models.md` lines 50-52, which rejects `temperature`/`top_p`/`top_k` with HTTP 400), `modelStripsTemperature()` returns true and the fingerprint records temperature absence — even though `compile.ts:1257` still hardcodes `temperature: 0` at the `runOrchestrator` call. [mmnto-ai/totem#1476](https://github.com/mmnto-ai/totem/issues/1476) tracks the latent SDK fix for the seven sites that still pass `temperature` against the SDK; this PR documents the latency without fixing it.

  **Prompt-template content hash.** Hashes `packages/cli/src/commands/compile-templates.ts` (or its built `compile-templates.js` sibling at runtime, resolved via `import.meta.url`). Per Path A in Proposal 278 § Open Questions, the source `.ts` and built `.js` move in lockstep through tsc — drift surfaces either way. The file is 100% prompt-relevant (`KIND_ALLOW_LIST` + `COMPILER_SYSTEM_PROMPT` + `PIPELINE3_COMPILER_PROMPT`); no orthogonal utility code makes the file-level hash a false-positive risk.

  **Detection regex.** `modelStripsTemperature()` matches `/opus-4-[7-9]|opus-[5-9]/`. Naive but matches the current Anthropic family naming (`claude-opus-4-7`, `claude-opus-4-7-1`, future `claude-opus-5-0`). When Anthropic ships a new family that strips sampling params (Sonnet 5.0+, Haiku 5.0+), widen here. A.3.b's `totem doctor --compliance` is the natural future home for richer reconciliation.

  **Tests.** 6 new unit tests on `computeCompileWorkerFingerprint` (determinism, model/temperature/prompt-hash sensitivity, absence-vs-placeholder distinction, sha256-shape), 12 cases on `modelStripsTemperature`, 2 cases on `readPromptTemplateContentHash` (line-ending normalization, missing-file error class), 2 cases on the schema (pre-#1937 manifest parses; new manifest roundtrips). 6 integration tests on `verify-manifest` exercise the drift gate against real git repos: same-fingerprint passes, no-fingerprint passes (Phase 1 anthropic-only), drift-without-template-edit fails, drift-with-template-edit passes, override-without-justification fails, override-with-`TOTEM_DRIFT_JUSTIFICATION` passes. Full local sweep: 1947 `@mmnto/totem` tests + 2174 `@mmnto/cli` tests green.

  **Cohort pause.** This is the gating implementation PR for [mmnto-ai/totem-strategy#335](https://github.com/mmnto-ai/totem-strategy/pull/335) Proposal 278. The cohort PR pause broadcast at `_broadcast/inbox/2026-05-16T0818Z-strategy-claude.md` (non-urgent rule-touching PRs deferred across cohort) lifts once this lands.

  Closes the Action 3 Phase 1 implementation surface. Phase 2 (shell-orchestrator capture) + sibling option (d) (decouple wind-tunnel fixtures from `lessonHash`) + [mmnto-ai/totem#1938](https://github.com/mmnto-ai/totem/issues/1938) per-orphan dispositions proceed in parallel post-merge.

### Patch Changes

- Updated dependencies [14fbb74]
  - @mmnto/totem@1.42.0

## 1.41.0

### Minor Changes

- 9bc412c: feat(cli+core): add `totem verify-badges` deterministic pre-push gate for shields.io claims (mmnto-ai/totem#1926)

  Mechanizes the claim-discipline failures from #1925 R1 / R2, #1932, and #1933 — all four were post-merge audit catches of README claims that a deterministic check could have blocked at pre-push time. This is the _mechanism-tier_ gate per Tenet 15 (axiom mandate: encode rules as mechanism, not prose); it complements the LLM-tier spot-check shipped in `mmnto-ai/totem-strategy#331` (Proposal 277, Ollama).

  **New CLI command:** `totem verify-badges` scans `README.md` additions in the branch diff and runs two deterministic checks against every shields.io badge:
  1. **Tool-claim verification** — if the badge text names a tool (`Claude`, `Gemini`, `Cursor`, `Windsurf`, `Copilot`), at least one of the tool's integration files/directories must exist in the repo. Falsifying metric is file existence.
  2. **Self-reference detection** — standard-claim badges (`AGENTS.md`, `MIT`, `Apache 2.0`, BSD/GPL/MPL variants) must link to canonical upstream docs, not internal repo paths (e.g., flagging `[![AGENTS.md](...)](./AGENTS.md)` as circular).

  The check is stateless (no SHA-stamped flag files; recomputes from `git diff <base>...HEAD` each run), fast (file-existence O(badges × tool-claims), no network), and pre-push-budget compliant (ADR-031 FR-P01 <3s).

  **Auto-wired into the pre-push hook** (`buildPrePushHook` in `install-hooks.ts`) gated on `README.md` and `.totem/compiled-rules.json` existing, alongside the existing `verify-manifest` + `lint` gates. Cohort repos that haven't installed Totem pipelines don't fire the check.

  **New `@mmnto/totem` exports:** `extractBadgesFromDiff`, `verifyToolClaims`, `verifySelfReferenceLinks`, `DEFAULT_TOOL_INTEGRATIONS`, `ToolIntegrationConfigSchema`, `BadgeVerificationResultSchema`, plus types `ExtractedBadge` / `ToolIntegrationConfig` / `BadgeVerificationResult` / `PathExistsPredicate`.

  **Scope cut (Q1 from spec):** Verification C (gh-api shape-usage threshold) deferred to a follow-on PR. A + B mechanize 2 of the 3 documented failures; C carries a network dependency (gh CLI + auth + rate limits → graceful-degrade) that deserves its own PR description and test plan.

  **Doctrine framing:** This PR is the _deterministic-tier_ complement to:
  - `mmnto-ai/totem-strategy#331` (Proposal 277) — the LLM-tier Ollama spot-check.
  - WWND Claim-Discipline Gate proposal (queued on strategy-Claude's lane).
  - Tenet 19 covenant-claims-as-third-category amendment (queued on strategy-Claude's lane).

  Verified locally: 1922 `@mmnto/totem` tests + 2168 `@mmnto/cli` tests all green.

### Patch Changes

- Updated dependencies [9bc412c]
  - @mmnto/totem@1.41.0

## 1.40.2

### Patch Changes

- d725010: fix(ci): audit + sweep narrow timing thresholds across packages

  Three independent CI flakes hit across three platforms in three hours after the #1928 merge to main, each on a different timing-window assertion:
  - **Ubuntu** (`@mmnto/mcp` `ledger-writer.test.ts`): vitest `testTimeout` 5_000ms tripped on cold-import (fixed in #1928).
  - **macOS** (`@mmnto/totem` `regex-safety/evaluator.test.ts:97`): `softWarningMs: 1` + 1000 trivial-pattern lines finished <1ms on fast hardware; `softWarningTriggered` assertion flipped false.
  - **Windows** (`@mmnto/cli` `run-compiled-rules.test.ts:203`): `RegexEvaluator` `DEFAULT_CONFIG.timeoutMs: 100` tripped at "timeout after 139ms" on a single-line `.sh` corpus — Windows worker thread spawn + IPC + shared-runner scheduling jitter exceeded the budget.

  This PR audits and uniformly addresses the class:

  **1. Vitest test-runner ceilings (4 configs)** — `packages/{cli,core,pack-agent-security,pack-rust-architecture}/vitest.config.ts` bumped non-Windows floor `5_000` → `15_000` to match the `@mmnto/mcp` precedent set in #1928. Windows stays at 30_000 (subprocess spawn). Comments updated to call out the shared-runner cold-import class explicitly.

  **2. `RegexEvaluator` production defaults** (`packages/core/src/regex-safety/evaluator.ts`) — `timeoutMs: 100 → 250`, `softWarningMs: 50 → 100`. 250ms keeps per-rule budget snappy in production while giving Windows worker IPC + CI scheduling ~2× headroom over the observed worst case (139ms). Backward compatible: callers passing explicit config are unaffected; callers using defaults gain headroom.

  **3. Soft-warning wall-clock test** (`packages/core/src/regex-safety/evaluator.test.ts:92`) — refactored from `softWarningMs: 1` + 1000 lines to `softWarningMs: 5` + 50_000 lines. Same assertion, but 50× wall-clock margin instead of a 1ms threshold racing fast hardware.

  No public API change. Verified locally: 2161 `@mmnto/cli` tests + matching cohort across `@mmnto/totem`, `@mmnto/mcp`, and the two packs all green.

- Updated dependencies [d725010]
  - @mmnto/totem@1.40.2

## 1.40.1

### Patch Changes

- @mmnto/totem@1.40.1

## 1.40.0

### Minor Changes

- 986825c: feat(mcp+cli): Trap Ledger activity writers — MCP `mcp_call` + SessionStart `session_start` (A.3.a writers)

  Stacked on #1919 (A.3.a schema). Wires the two activity-event writers that the A.3.b compliance metric will read. Without these writers, the schema is inert — no events of the new types get produced.

  ## Writers shipped

  **MCP `mcp_call` writer** (`packages/mcp/src/ledger-writer.ts`):
  - New `logMcpCall(activityName)` helper. Fire-and-forget; internal try/catch + outer `.catch()` defense-in-depth at call sites.
  - Wired into `packages/mcp/src/tools/search-knowledge.ts` — emits `{ type: 'mcp_call', activity_name: 'search_knowledge', session_id, source: 'bot' }` at handler entry. Reads `session_id` from `.totem/ledger/.session-id` if present (TTL 24h), omits when missing.
  - Other MCP tools (`describe_project`, `add_lesson`, `verify_execution`) intentionally NOT wired in this PR — `search_knowledge` is the only one ADR-029's compliance metric measures. Symmetric wiring deferred to A.3.c when broader observability lands.

  **SessionStart hook writer** (`packages/cli/src/commands/init-templates.ts`):
  - `CLAUDE_SESSION_START` template extended to mint a session UUID via `crypto.randomUUID()`, persist to `.totem/ledger/.session-id`, and append a `session_start` activity event to `events.ndjson` BEFORE the existing `totem describe` briefing.
  - Inline implementation (no `@mmnto/totem` import) — hook scripts run via `node` from project root before any package resolution, so they can't depend on the totem npm packages being installed.
  - Gemini SessionStart hook (`GEMINI_SESSION_START`) intentionally NOT updated in this PR. Symmetric Gemini parity deferred to a follow-on.

  ## New core utilities (`packages/core/src/session-id.ts`)
  - `mintSessionId()` — wraps `crypto.randomUUID()`.
  - `writeSessionId(totemDir, sessionId)` — persists to `.totem/ledger/.session-id`. Swallows expected fs error classes (ENOENT/EACCES/EPERM/EROFS) via the optional `onWarn` callback and rethrows unexpected error classes per Tenet 4 Fail Loud.
  - `readSessionId(totemDir, ttlHours?)` — reads + validates UUID shape + checks mtime against TTL (default 24h). Returns `undefined` for missing/expired/malformed files.

  ## Tests
  - `packages/core/src/session-id.test.ts` — 15 tests covering mint uniqueness, write/read round-trip, malformed UUID rejection, TTL expiration (file backdating via `utimesSync`), custom TTL argument, trailing-whitespace tolerance, plus fs error class discrimination on read (ENOENT/EACCES/EPERM/EROFS swallow vs unexpected rethrow per Tenet 4).
  - `packages/mcp/src/ledger-writer.test.ts` — 5 tests covering event emission, session_id population/omission, getContext failure (must not throw), append-don't-overwrite.
  - `packages/mcp/src/tools/search-knowledge.test.ts` — 2 new integration tests verifying handler emits `mcp_call` with `activity_name: 'search_knowledge'`, including the dimension-mismatch error path (invocation, not success, is what ADR-029 measures).
  - `packages/cli/src/commands/init.test.ts` — 5 new tests covering the SessionStart template's session-id minting, persistence, ledger-event emission, agent_source stamping (Claude-specific), and fire-and-forget error-handling.

  ## Backward compatibility

  Same forward-only story as A.3.a schema:
  - Pre-writers Trap Ledgers don't contain `mcp_call` or `session_start` events — readers parse them fine when they appear post-upgrade.
  - SessionStart hook ledger-write block is in its own try/catch; if it fails (read-only filesystem, missing perms, etc.), the briefing path still runs.

  ## ADR alignment
  - ADR-029 § Session Heuristic: explicit UUID supersedes the rolling-2h activity heuristic when `.session-id` is present.
  - ADR-078 § Event Attribution: `source: 'bot'` for both writers (emitter = MCP server / hook subsystem). In this lift, `session_start` includes `agent_source: 'claude'` (the Claude hook template knows its vendor); MCP `mcp_call` agent attribution is deferred to A.3.c via orchestrator → MCP correlation propagation.
  - ADR-077 Smart Briefing: SessionStart hook already shipped (`installClaudeHooks` scaffolds the script); this PR only extends its body.

  ## Out of scope (next sub-lifts)
  - **A.3.b** — `totem doctor --compliance` reads these events and computes the ADR-029 metric (~1 week).
  - **A.3.c** — orchestrator → MCP correlation_id propagation; populates `agent_source` (~1 week).
  - **A.4.a / A.4.b** — PreToolUse soft-block + pre-push hard-block (per C-12); reads `mcp_call` events to gate Write/Edit on `proposals/active/**`, `adr/**`, `research/**`.
  - **Gemini SessionStart writer** — symmetric pattern, deferred for parity sweep.
  - **Other MCP tools** (`describe_project`, `add_lesson`, `verify_execution`) — wire `logMcpCall` when needed for broader observability.

### Patch Changes

- Updated dependencies [986825c]
  - @mmnto/totem@1.40.0

## 1.39.0

### Minor Changes

- 1934f13: feat(core): Trap Ledger schema extension — agent attribution + activity events (A.3.a)

  Forward-only schema extension to `LedgerEventSchema` in `packages/core/src/ledger.ts`. First lift of the A.3 telemetry sprint (three-stream claim-discipline consensus, design doc at `mmnto-ai/totem-substrate:.handoff/_shared/2026-05-15-a3a-schema-extension-design.md`).

  **New event types** (activity family):
  - `mcp_call` — MCP tool invocation; `activity_name` discriminates (`search_knowledge`, `describe_project`, ...)
  - `tool_call_first_significant` — first non-Read/Grep/Glob orchestrator tool call in session
  - `hook_fire` — lifecycle hook executed; `activity_name` discriminates (`SessionStart`, `PreToolUse`, `pre-push`, ...)
  - `session_start` — SessionStart hook fired; new `session_id` minted

  **New optional fields:**
  - `agent_source: 'claude' | 'gemini' | 'human'` — agent runtime attribution, orthogonal to `source` (emitting subsystem). Implements ADR-078 § Event Attribution; renamed from the ADR's `source` to disambiguate against the load-bearing emitter identifier already in production.
  - `session_id` (UUID) — session correlation, persisted at `.totem/ledger/.session-id` per ADR-029 § Session Heuristic.
  - `correlation_id` (UUID) — trace correlation per ADR-014; populated by A.3.c end-to-end propagation work.
  - `activity_name` — sub-type discriminator for activity events.

  **Field relaxations:** `ruleId` and `file` are now optional at the schema level to accommodate activity events. Writer-side discipline enforces required-by-type for `suppress` / `override` / `exemption`. Promotion to a Zod `discriminatedUnion` is deferred to A.3.c per design doc OQ-1 (strategy-Claude T0345Z disposition agreed; rationale and gap-filler tests in `ledger.test.ts` § "writer-side per-branch field presence" lock the discipline until the schema enforces it structurally).

  **Backward compatibility:**
  - Pre-A.3.a override events (no new fields) parse fine — all new fields optional.
  - Post-A.3.a activity events read by pre-A.3.a code: silently dropped (`safeParse` fails on unknown enum value, line skipped). Acceptable — no data corruption, only telemetry-visibility loss in stale tooling. Cohort version bump after merge closes this naturally.

  **Doc-sync (bundled):** `docs/wiki/trap-ledger.md` example corrected — pre-existing drift surfaced during A.3.a empirical pass. Three drifts fixed:
  - Example `type` was `"exception"` (invalid; not in the enum) → now `"suppress"`.
  - Example `source` was `"totem-context"` (bypass-marker; conflated with code's emitter identifier) → now `"lint"`.
  - Prose claimed `// totem-context:` directives log `override` events — corrected to `suppress` per code comment in `LedgerEventSchema.type`.

  Activity-event example added for `mcp_call` / `search_knowledge` shape.

  **Out of scope (next sub-lifts):**
  - A.3.b: `totem doctor --compliance` reads this schema and computes the ADR-029 metric (~1 week).
  - A.3.c: orchestrator → MCP `correlation_id` propagation (~1 week).
  - A.4.a / A.4.b: PreToolUse soft-block + pre-push hard-block pair (per C-12, ships alongside A.3.a).

  ADR-078 surface amendment (rename agent attribution from `source` to `agent_source` in § Decision 2) landed at `mmnto-ai/totem-strategy#329` (commit `b830e0c` on main). Includes the first `Falsifying Metric:` field in the ecosystem per Tenet 19 — sibling capability-claim ADRs 014/029/044 backfilled in `mmnto-ai/totem-strategy#330`.

### Patch Changes

- Updated dependencies [1934f13]
  - @mmnto/totem@1.39.0

## 1.38.0

### Minor Changes

- 923deb0: feat(doctor): add `--strict` mode + pre-push hook integration + CI workflow template (#1908)

  Implements Proposal 273 § 7 routing matrix rows 5+6 (Repo + Auto + Both) for the first repo-state diagnostic (`checkAgentsMdCanonical`, shipped in #1907).
  - `totem doctor --strict` now exits non-zero when any check reports `fail` (`warn` results remain informational). Default behavior unchanged.
  - Pre-push hook injects `totem doctor --strict` inside the existing strict-tier guard (`is_agent=1` or `TOTEM_HOOK_TIER=strict`), mirroring the `totem review` shield gate. Standard-tier humans bypass; agents and explicit strict-tier operators get the gate.
  - New `.github/workflows/totem-doctor.yml` template runs `doctor --strict` on PR + push to main. Cohort repos can copy or reference.

  Exit-code decision lives at the CLI edge — `doctorCommand` returns `DiagnosticResult[]` and does not touch `process.exit` / `process.exitCode`.

  **Calibration fix bundled.** `checkEmbeddingConfig` previously reported `fail` when the configured embedder's env key (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY`) was missing. That misclassified an operator-setup state as a repo defect — empirically surfaced when `totem doctor --strict` ran in CI on this PR (CI intentionally lacks the keys). Both branches now return `warn`, mirroring `checkOllama`'s warn-on-unreachable pattern. The repo's config is correct; the local environment is incomplete.

### Patch Changes

- Updated dependencies [923deb0]
  - @mmnto/totem@1.38.0

## 1.37.0

### Minor Changes

- af26791: feat(doctor): add `agents-md-canonical` diagnostic per Proposal 272 § 6.7

  Verifies that `CLAUDE.md` follows the ADR-038 redirect-shape constraint:
  - Gates on whether the cwd is a project root (`package.json` OR `.git` present).
  - Passes if there's no `CLAUDE.md` (nothing to enforce).
  - Passes if `CLAUDE.md` is ≤ 600 bytes.
  - Fails if `CLAUDE.md` claims to be a redirect (matches the canonical-phrase + `AGENTS.md` link pattern) but `AGENTS.md` does not actually exist.
  - Fails if `CLAUDE.md` is > 600 bytes AND does not match the redirect pattern.
  - Passes for a "verbose redirect" (> 600 bytes but matches the pattern AND `AGENTS.md` exists) — covers downstream consumers who pad the redirect with vendor-specific addendums.

  Surface translation: Proposal 272 § 6.7 names this as a `totem lint` rule, but `totem lint` is diff-based content scanning. The predicate here is a repo-shape check, which fits the existing `check*` function registry in `doctor.ts`. Routing confirmed by strategy-Claude.

  Closes #1905. Follow-on `doctor --strict` + pre-push wiring tracked in #1906.

### Patch Changes

- @mmnto/totem@1.37.0

## 1.36.0

### Minor Changes

- 1122e60: feat(hook): bot-pack wiring engine — CLI surface (ADR-104 PR-1 follow-on slice 1)

  Adds the `totem hook` noun-verb namespace with three subcommands. The legacy
  plural `totem hooks` (git-hooks installer) becomes a hidden one-cycle
  deprecation alias for the new `totem hook install`.

  New commands:
  - `totem hook run --tool <name> --args <args>` — PreToolUse runtime
    entrypoint. Loads `.totem/compiled-hooks.json`, evaluates each compiled
    hook against the tool-call payload, and emits a structured
    `[totem:hook-block]` rejection (exit code 2) on the first match. Allow
    path is exit code 0 with no block output — diagnostics (e.g.
    `[totem:hook-stale]` / `[totem:hook-schema]` / `[totem:hook-error]`)
    still flow to stderr when applicable.
  - `totem hook install` — git-hooks installer (renamed from `totem hooks`).
    Same behavior; the legacy plural remains as a hidden deprecation alias
    for one cycle.
  - `totem hook test [--filter <term>]` — runs fixtures with `surface: hooks`
    against compiled-hooks rules. Per-line failure reporting
    (`missed reject` / `false positive`). Fails loudly on manifest load
    errors and on orphan fixtures referencing unknown hook ids
    (Tenet 4 — no silent passes when pack wiring is broken).

  Public API:
  - `@mmnto/totem :: runRuleTests` now filters fixtures to `surface: 'rules'`
    (defaults to `'rules'` when absent — backwards-compat). Hooks-surface
    fixtures are dispatched through the new CLI `runHookTests` runner
    instead of surfacing as unknown-hash failures under `totem test`.

  Also includes the foundation API surface from #1894 that had not shipped
  under a changeset: `TotemErrorCode.HOOKS_LOAD_FAILED` and the re-exported
  `isRegexSafe` helper.

  Deferred from this slice:
  - `totem test` → `totem rule test` rename. The existing `totem rule test <id>`
    command (inline-lesson-example verifier) collides on the `test` subcommand
    name with different semantics. Conflict resolution + rename lands in
    slice 2 alongside `totem sync` integration and the cross-OS smoke matrix.

### Patch Changes

- Updated dependencies [1122e60]
  - @mmnto/totem@1.36.0

## 1.35.0

### Minor Changes

- 7575c5d: `totem init` now distributes the canonical `signoff` and `review-reply`
  session-utility skills into `.claude/skills/<name>/SKILL.md` on the Claude
  side, using marker-based replacement so canonical updates land everywhere
  on subsequent `totem init` runs while user-authored content below the end
  marker survives.

  `totem eject` mirrors the install — removes only marker'd files, with
  bottom-up pruning of empty `.claude/skills/<name>/` and `.claude/skills/`
  directories. User-authored skill files (no markers) are preserved.

  Phase C slice 3 (Closes `mmnto-ai/totem#1890`). Gemini parity for the same
  two skills is tracked separately as `mmnto-ai/totem#1891` (slice 4).

  The canonical content is single-sourced from
  `mmnto-ai/totem:.claude/skills/<name>/SKILL.md` with an invariant test
  that fails CI if the embedded constant ever drifts from the source.

### Patch Changes

- @mmnto/totem@1.35.0

## 1.34.3

### Patch Changes

- 9220169: `totem init` Gemini SessionStart hook template now calls `totem describe`
  instead of `totem status`, matching the family-canonical convergence
  (`totem-strategy`, `totem-substrate`, `arhgap11`, `totem-status` all
  already use `describe`) and pairing symmetrically with the Claude-side
  SessionStart hook scaffolded by the same init pass.

  The two commands produce different output. `totem describe` emits the
  `[Describe] Project: ... Lessons: N Targets: N Hooks: ...` orientation
  banner that consumers integrate against at session start. `totem status`
  emits "current project health" (manifest freshness, shield staleness)
  which serves a different purpose. The init template had drifted to
  `status` at some point; this restores the canonical pattern.

  Also updates the `CLAUDE_MD_TEMPLATE` "Start of Session" prose to reflect
  the role distinction: the SessionStart hook automatically runs `describe`
  for orientation; agents can run `status` ad-hoc for freshness checks.

  Closes `mmnto-ai/totem#1884`. Slice 2 of the original
  `mmnto-ai/totem#1845` 3-way split; slice 1 (symmetric Claude SS hook)
  shipped in `mmnto-ai/totem#1862`. Slice 3 (session-utility skill suite
  distribution) remains queued.
  - @mmnto/totem@1.34.3

## 1.34.2

### Patch Changes

- 56bf601: `totem lesson compile --export` and `totem lesson archive` now surface
  `status: archived` rules in the agent-facing digest with an
  `_(archived: <reason>)_` annotation suffix instead of silently dropping
  them. The export digest is the LLM's knowledge surface; Stage-4 archival
  concerns pattern-matching false positives, not lesson-prose validity, so
  the prose stays useful as agent context even when the compiled regex is
  silenced at lint time.

  `status: untested-against-codebase` rules continue to be suppressed in the
  export per the CR `mmnto-ai/totem#1757` R2 rationale (Stage 4 declared
  their behavior unknown, agent context shouldn't rely on them either). The
  `loadCompiledRules` lint-time filter is unchanged.

  Closes `mmnto-ai/totem#1873`. Empirical evidence base: lc-Claude's
  `mmnto-ai/liquid-city#238` postmerge run reproduced n=2 archival drops
  across three consecutive `compile --export` invocations (199 → 198 → 198).
  Both symptoms (ordering-dependent first-run inclusion and deterministic
  re-export drop) collapse with this change.

  The hash-drift bug that surfaced Symptom A's ordering dependence remains
  as a separate latent concern in the `untested-against-codebase` filter
  path. Filed as a follow-up Tier-3 for narrow investigation.
  - @mmnto/totem@1.34.2

## 1.34.1

### Patch Changes

- Updated dependencies [9e7606d]
  - @mmnto/totem@1.34.1

## 1.34.0

### Minor Changes

- f4c09b6: `totem init` now probes the local Ollama daemon (`http://localhost:11434/api/tags`)
  during fresh project setup and emits a one-line floor-expectation message before the
  embedding-tier branch runs. When detected, the message reports the daemon URL; when
  absent, it includes the install hint (`https://ollama.com`). Skipped in `--bare`
  mode (no embedder configured) and on re-runs over an existing config (the floor was
  surfaced at first init).

  Closes the consumer-side discoverability gap that motivated the `LazyEmbedder`
  fallback chain in `mmnto-ai/totem#522`: cloud-key auto-detection silently picked
  Gemini/OpenAI without ever telling the user Ollama is the recommended local floor,
  so when the cloud provider failed at `totem sync` time, consumers reached for
  `pnpm add @google/genai` (a Tenet 16 vendor-coupling workaround that propagated
  across `mmnto-ai/totem-strategy`, `mmnto-ai/totem-status`, and `mmnto-ai/liquid-city`)
  instead of the documented Ollama install.

  New public helper: `probeOllamaFloor()` exported from `@mmnto/cli`'s init module —
  returns `{ available, baseUrl, message }`, never throws, uses the same 3-second
  `AbortSignal` timeout as `LazyEmbedder` and `totem doctor`. Mirrors the
  `checkOllama` doctor diagnostic shipped in PR-1 (`mmnto-ai/totem#1860`).

  Closes `mmnto-ai/totem#1851` (PR-2 of 2 — completes the original two-surface ask;
  PR-1 covered the `totem doctor` half plus the empirical regression test that locks
  the `LazyEmbedder` `TotemConfigError` fallback contract).

### Patch Changes

- Updated dependencies [f4c09b6]
  - @mmnto/totem@1.34.0

## 1.33.0

### Patch Changes

- Updated dependencies [3c3f48e]
  - @mmnto/totem@1.33.0

## 1.32.0

### Patch Changes

- Updated dependencies [e378ab4]
  - @mmnto/totem@1.32.0

## 1.31.0

### Patch Changes

- Updated dependencies [2003419]
  - @mmnto/totem@1.31.0

## 1.30.1

### Patch Changes

- Updated dependencies [73396f0]
  - @mmnto/totem@1.30.1

## 1.30.0

### Patch Changes

- Updated dependencies [0c5fd65]
  - @mmnto/totem@1.30.0

## 1.29.0

### Minor Changes

- Add universal agent orientation lesson.

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.29.0

## 1.28.1

### Patch Changes

- 748b5e6: `totem lint` skips gracefully when `compiled-rules.json` is empty (mmnto-ai/totem#1831).

  Empty-corpus repos (e.g., aspirational pre-lessons setups like `totem-status`) used to hit a hard `NO_RULES` `TotemError` at `run-compiled-rules.ts:113-119` whenever a non-empty diff reached the lint runner. The runner now logs the empty-corpus state and returns an empty result so the caller exits cleanly. This matches the implicit no-op state of repos that have not yet run `totem lesson compile` and have no `compiled-rules.json` on disk — both paths produce zero violations and a zero exit code.

  Consumers that need a "rule count > 0" CI guardrail can check `.totem/compiled-rules.json` rule count directly in their pipeline; the runner deliberately does not opinionate on that policy.

  Bisection note: the strict throw was added in mmnto-ai/totem#1553 (2026-04-18) and shipped unchanged through 1.26.x and 1.27.0. mmnto-ai/totem#1831 framed it as a 1.28.0 regression based on consumer-side observation; the actual 1.28.0 change was an environmental shift (a non-empty diff reached the runner where prior CI passes had returned early via `getDiffForReview`). The behavior change here is the same regardless of framing.
  - @mmnto/totem@1.28.1

## 1.28.0

### Minor Changes

- bd3fd71: `totem sync` Phase A / Phase B architectural separation (mmnto-ai/totem#1811, ADR-101).

  `totem sync` decomposes into two independently-runnable phases:
  - **Phase A** — deterministic pack-resolution + `installed-packs.json` write (no API key required, runs in CI).
  - **Phase B** — vector-store embedding sync (still requires the embedding key; unchanged).

  New mutually-exclusive flags on `totem sync`:
  - `--packs-only` (Lite tier): write the pack manifest only; skip embedding sync, prune, the global registry update, and the `review-extensions.txt` write. Designed for CI environments without API keys after a `@mmnto/totem` cohort bump where pack-resolution alone needs to run before `totem lint` recognizes newly registered Tree-sitter languages.
  - `--index-only` (Standard tier): run only the embedding sync; skip pack-resolution. Use when `installed-packs.json` is already current and only the vector store needs to re-embed.

  `--packs-only` hard-errors when combined with `--index-only`, `--full`, or `--prune` — Phase B is skipped under `--packs-only`, so those flags would silently no-op. `--index-only` composes with `--full` and `--prune` since all three modify Phase B.

  The CLI orchestrator now writes `installed-packs.json` BEFORE invoking `runSync` so `--packs-only` can short-circuit cleanly. The default flag-less behavior is observably equivalent to prior releases.

  UX nudge for stale manifests: when a rule expects a Tree-sitter language that isn't registered, the rule-engine now consults `installed-packs.json`'s cohort field and surfaces a structured `STALE_MANIFEST` `TotemError` pointing at `totem sync --packs-only` whenever the manifest is missing, pre-1.27.0, or written by an engine whose `major.minor` differs from the running version. Patch-level cohort drift passes (caret-range pack semver tolerance). Cohort-match falls through to the original "install the pack" `TotemParseError`.

  Schema: `InstalledPacksManifestSchema` gains an optional `cohort: string` field (semver). Pre-1.27.0 manifests without the field continue to parse cleanly. Stamped at write time by `writeInstalledPacksManifest()` from `resolveEngineVersion()`; tests can pre-populate the field to override the stamp.

  New public surfaces (additive):
  - `resolveEngineVersion(): string`
  - `detectStaleManifest(opts): StaleManifestDetection | null`
  - `staleManifestError(detection, context): TotemError`
  - `TotemErrorCode` adds `'STALE_MANIFEST'` and `'FLAG_CONFLICT'`.

### Patch Changes

- Updated dependencies [bd3fd71]
  - @mmnto/totem@1.28.0

## 1.27.0

### Patch Changes

- Updated dependencies [5f4658f]
  - @mmnto/totem@1.27.0

## 1.26.1

### Patch Changes

- c857383: Resolve `.totem/` against `configRoot` instead of `cwd` in `compile` and `test-rules`.

  Closes mmnto-ai/totem#1796. Both commands already compute `configRoot = path.dirname(configPath)` at the top of the function (added in PR #1795 for `bootstrapEngine`), but the downstream `path.join(cwd, config.totemDir)` calls still used `cwd`. In monorepo subpackage invocations where `cwd != configRoot`, that resolved `.totem/` to the wrong directory — pack/manifest state was read from the configRoot, but lessons, compiled rules, and test fixtures were read from the subpackage's cwd.

  Mirrors the configRoot-relative pattern already established in `run-compiled-rules.ts:107` and `first-lint-promote-runner.ts:45`. New regression test (`path-harmonization.test.ts`) chdirs into a nested subpackage and asserts both commands invoke their downstream consumers with configRoot-relative paths.

- 32c5dd9: Compute Stage 4 manifest exclusion path against `repoRoot`, not `config.totemDir`.

  Follow-up to PR #1812 (closes #1796) catching GCA HIGH on the auto-VP PR #1814. The `activeManifestPath` exclusion key in `compile.ts` is compared against `git ls-files` output, which is repo-root-relative. Joining `config.totemDir` alone produced the wrong key when `cwd != configRoot != repoRoot` (monorepo subpackage invocation): the exclusion failed to match the repo-relative `git ls-files` line, so `compiled-rules.json` slipped into the Stage 4 scan corpus and self-matched against rules' own `badExample` text.

  Resolution: defer the `activeManifestPath` computation into the verifier closure (after `repoRoot` is resolved) and use `path.relative(repoRoot, path.join(totemDir, 'compiled-rules.json'))`. Mirrors the canonical pattern at `first-lint-promote-runner.ts:99`. Pre-existing tech debt tracked in MEMORY.md from claude-0014; PR #1796's surgical scope (lessons / rules / fixtures resolution) didn't touch it. GCA's review on the VP PR was the natural moment to close it.
  - @mmnto/totem@1.26.1

## 1.26.0

### Minor Changes

- c00dc7b: **ADR-097 § Q6 amended — engine-version constraint moves from `peerDependencies` to `engines` (closes #1803).**

  Pack manifest resolver (`pack-manifest-writer.ts:readEngineRange`, formerly `readPeerEngineRange`) now reads `engines['@mmnto/totem']` from the resolved pack's `package.json` instead of `peerDependencies['@mmnto/totem']`. The boot-time engine-version cross-check (`pack-discovery.ts:assertEngineRangeSatisfied`) reads the same value via `installed-packs.json#packs[].declaredEngineRange` and continues to fail loud on semver mismatch.

  **Why the move:**
  - `engines` is npm-canonical for engine-version constraints. `peerDependencies` is for actual peer packages the consumer must install (e.g., `@ast-grep/napi`). Mechanism mapping is now correct.
  - Symmetry across the cohort. Internal and future external packs declare `engines.@mmnto/totem` consistently; `peerDependencies` is uniformly for actual peer packages only.
  - Closes the structural collision with `mmnto-ai/totem#1777` (the `1.22.0 → 2.0.0` wiggle root cause): a fixed-group sibling pack cannot peer-dep `@mmnto/totem` without triggering a changesets MAJOR cascade. The `engines` field is not touched by changesets fixed-group auto-bump, so the wiggle stays prevented even with a declared engine constraint.

  **Migration shape:**
  - `@mmnto/pack-rust-architecture` and `@mmnto/pack-agent-security` now declare `"engines": { "@mmnto/totem": "^1.25.0" }`. Neither declares `@mmnto/totem` in `peerDependencies` (locked by `structure.test.ts` invariants in both packs).
  - The `not-a-pack` warning in `totem sync` was reworded to point at the actual gap: `"missing engines['@mmnto/totem'] declaration — pack cannot satisfy the engine-version cross-check (ADR-097 § 5 Q6). Add '"engines": { "@mmnto/totem": "^<version>" }' to the pack's package.json and republish."` Pre-#1803 text was misleading per `mmnto-ai/totem#1803`'s reproducer (it claimed the registration callback was missing when the callback was correctly exported).
  - No fallback to the legacy `peerDependencies['@mmnto/totem']` slot. Pre-1.26.0 packs that declared the engine constraint via peerDeps (none known to exist outside the `@mmnto/*` cohort, all of which are migrated in this cohort) must republish with `engines` declared.

  Closes #1803.

### Patch Changes

- Updated dependencies [c00dc7b]
  - @mmnto/totem@1.26.0

## 1.25.0

### Minor Changes

- 5cf67ab: Wire pack registration into CLI command boot sequence (ADR-097 § 10).

  Closes mmnto-ai/totem#1794. Adds a `bootstrapEngine(config, projectRoot)` helper invoked by `lint`, `shield`, `compile`, and `test-rules` immediately after `loadConfig`. The helper calls `loadInstalledPacks()` so pack-contributed languages, chunkers, and grammars register before any AST rule dispatch — fulfilling the contract documented in `pack-discovery.ts` and `.totem/specs/pack-substrate-bundle.md` since 1.22.0 but never invoked from a CLI surface.

  Idempotent within one Node process via `isEngineSealed()`, so test harnesses running multiple commands in sequence do not throw "engine sealed". Production CLI invocations are fresh processes, so single-shot seal is the production path.

  **Closes the Pack v0.1 substrate-wiring gap end-to-end.** Downstream consumers extending their `totem.config.ts` with `extends: ['@mmnto/pack-<lang>-architecture']` now see pack callbacks actually fire. Unblocks ADR-097 Stage 1 alpha-pilot graduation gate and the Liquid City PR-C cascade. The pre-existing engine-side substrate (PR-A, 1.22.0) and the pilot pack (PR-B, 1.23.0) are now reachable end-to-end from `totem lint` for the first time.

  No core API changes — `isEngineSealed` and `loadInstalledPacks` were already exported; this PR adds only the CLI-side invocation.

### Patch Changes

- @mmnto/totem@1.25.0

## 1.24.0

### Minor Changes

- 67c3ad3: **ADR-091 § Bootstrap Semantics: pack pending-verification install→lint promotion (#1684)**

  Closes the cloud-compile bootstrap gap that ADR-091 § Bootstrap Semantics defined: pack rules cannot be trusted to fire on the consumer's codebase until Stage 4 verifies them locally, so they now enter the consumer's manifest as `'pending-verification'` and the next `totem lint` runs the verifier and promotes them per outcome.

  **`CompiledRule.status` enum extended** with a fourth lifecycle value `'pending-verification'` alongside `'active' | 'archived' | 'untested-against-codebase'`. The lint-execution path (`loadCompiledRules`) treats it as inert exactly like `'archived'` and `'untested-against-codebase'`; the admin path (`loadCompiledRulesFile`) returns it unfiltered so the promotion interceptor can find pending entries.

  **`totem install pack/<name>`** now stamps every pack rule `'pending-verification'` regardless of the status the pack shipped with. The pack's authoring environment cannot have run Stage 4 against the consumer's codebase, so the cloud-compile status is meaningless on the consumer side. The install command appends `Run \`totem lint\` to activate pack rules` to its output as the activation hint.

  **`.totem/verification-outcomes.json`** is the new committable side-table that memoizes Stage 4 outcomes across runs. The first lint run after install reads pending rules from the manifest, invokes the Stage 4 verifier on each, maps the outcome to one of the four terminal lifecycle values per Invariant #3, atomically writes the outcomes file with canonical-key-order serialization (Invariant #11 — byte-stable across runs so consumer repos see no phantom diffs), and saves the mutated manifest. Subsequent lint runs read the recorded outcome from the file and skip re-verification (Invariant #4); a pack content update produces a new `lessonHash` which has no recorded outcome, so the verifier runs again (Invariant #5).

  **Per-rule verifier-throw isolation** (Invariant #7): one failing rule's verifier-throw does not abort the lint pass; that rule remains `'pending-verification'` and the next lint retries.

  **Empty-pending fast path** (Invariant #9): the common-case lint pass with zero pending rules pays no verification cost and skips the outcomes-file read entirely.

  **New public API** in `@mmnto/totem`:
  - `promotePendingRules(rules, deps)` and `applyOutcomeToRule(rule, entry)` — the core interceptor.
  - `readVerificationOutcomes(filePath, onWarn?)` and `writeVerificationOutcomes(filePath, outcomes)` — the persistence layer.
  - `VerificationOutcomeEntrySchema`, `VerificationOutcomesFileSchema`, `Stage4OutcomeStored` — Zod schemas.
  - `VerificationOutcomesStore`, `VerificationOutcomesFile`, `VerificationOutcomeEntry`, `Stage4OutcomeStoredValue`, `PromotePendingRulesDeps`, `PromotePendingRulesResult` — types.

  **Naming-collision context (option B):** the original ADR-091 draft specified `.totem/rule-metrics.json` for the verification-outcomes file, but `packages/core/src/rule-metrics.ts` already exists as a per-machine telemetry-cache module (`triggerCount`, `suppressCount`, `evaluationCount`) with a gitignored `.totem/cache/rule-metrics.json` lifetime. ADR-091 § 65 was amended to specify `.totem/verification-outcomes.json` instead — separate filename for the new committable verification state, separate module name (`verification-outcomes.ts`) for the new schemas + persistence layer.

### Patch Changes

- Updated dependencies [67c3ad3]
  - @mmnto/totem@1.24.0

## 1.23.0

### Minor Changes

- 94ea4a8: **Pack v0.1 alpha pilot: `@totem/pack-rust-architecture` lift + ADR-091/097 substrate completion (#1773)**

  First non-trivial consumer of the ADR-097 § 10 Pack v0.1 substrate (#1768/#1769/#1770 in 1.22.0). Validates the substrate end-to-end by registering Rust as a language extension and dispatching ast-grep rules against `.rs` source.

  **`@totem/pack-rust-architecture@1.23.0`** — new package (`private: true`)
  - 8 baseline lessons sourced from `mmnto-ai/liquid-city#134` (slice-6 vehicle-agent + dispersion review cycle, lc-Claude attribution preserved)
  - Synchronous CJS `register.cjs` wires Rust into both engine paths: `api.registerLanguage('.rs', 'rust', wasmLoader)` for the web-tree-sitter side and `napi.registerDynamicLanguage({ rust })` for the @ast-grep/napi side (v0.1 side-channel, see `@mmnto/totem#1774`)
  - Bundled `tree-sitter-rust.wasm` (1.1 MB) sourced from `@vscode/tree-sitter-wasm@0.3.1` (MIT, Microsoft) via `prepare`-time copy
  - `compiled-rules.json` ships one tracer-bullet seed rule (`lesson-8cefba95`, Bevy hot-path `Local<Vec<T>>` per-tick allocation) — full LLM-compile of the 8-lesson set deferred to a focused follow-up since γ (per-language `KIND_ALLOW_LIST`, #1655) is needed before LLM-compile of Rust patterns avoids TS-grammar hallucinations
  - Runtime integration tests boot the pack via `loadInstalledPacks({ inMemoryPacks })` and verify the seed rule fires on `.rs` source through the full substrate path

  **`@mmnto/totem` — #1654 fix: thread target Lang through the compile-time pattern validator**

  Pre-#1654, `validateAstGrepPattern` always parsed under `Lang.Tsx` regardless of the rule's `fileGlobs`, and `inferBadExampleExts` (smoke gate) used a TS/JS-only regex that silently fell back to the default set for non-TS rules. A Rust pattern would either false-pass under TSX (the `ResMut<TacticalState>` exhibit) or false-fail with a TSX-parser error.
  - `validateAstGrepPattern(pattern, fileGlobs?)` now resolves the target Lang via `resolveAstGrepLangs(fileGlobs)` and accepts the pattern when any one Lang accepts it. Falls back to `Lang.Tsx` when fileGlobs is empty or no glob carries a registered extension (preserves legacy unscoped-rule semantics).
  - `inferBadExampleExts` extracts any trailing extension from `fileGlobs` (not just TS/JS); runtime's `extensionToLang` filters out unmapped extensions inside `matchAstGrepPattern` so unmapped extensions cleanly return zero matches without parsing under the wrong grammar.
  - New `resolveAstGrepLangs` helper exported alongside `extensionToLang` from `ast-grep-query.ts`.
  - 6 new regression tests covering the LC false-positive exhibit and the TS-fallback preservation invariant.

  **Substrate-extension follow-up filed as #1774 (tier-2, investigation)**: lift the napi-side language registration into `PackRegistrationAPI.registerNapiLanguage` once N≥2 pack consumers exist. PR-B's side-channel pattern in `register.cjs` is the time-boxed precedent that gathers design data; the side-channel is documented as visible debt in the pack's README.

### Patch Changes

- Updated dependencies [94ea4a8]
  - @mmnto/totem@1.23.0

## 1.22.0

### Minor Changes

- 5f2b0f2: ADR-097 § 10 Pack v0.1 substrate bundle (`mmnto-ai/totem#1768`). Bundles three substrate features that gate the Pack v0.1 alpha ship per ADR-097 § 6 Stage 1. PR-B (`@totem/pack-rust-architecture` lift) hard-blocks on this PR.

  **`mmnto-ai/totem#1768` — Pack discovery substrate.** New `packages/core/src/pack-discovery.ts` reads `.totem/installed-packs.json` synchronously at engine boot, runs each pack's registration callback with a `PackRegistrationAPI`, then seals both downstream registries before any chunker / language lookup happens. Per ADR-097 § 5 Q5 the boot path MUST be synchronous and MUST NOT walk `node_modules` dynamically.

  **Public API additions (exported from `@mmnto/totem`):**
  - `loadInstalledPacks(options?: LoadInstalledPacksOptions): readonly LoadedPack[]` — boot-time entry point. CLI commands invoke this immediately after config load. Idempotent only for the first call; second call after seal throws.
  - `loadedPacks(): readonly LoadedPack[]` — runtime snapshot of resolved packs.
  - `isEngineSealed(): boolean` — true after `loadInstalledPacks` returns.
  - `InstalledPacksManifestSchema` — Zod schema for `.totem/installed-packs.json`. Strict (`.passthrough()` rejected); unknown sibling keys fail loud.
  - `PackRegistrationAPI` interface — `registerChunkStrategy(name, ctor)` + `registerLanguage(extension, lang, wasmLoader)` are the two callback surfaces.
  - `PackRegisterCallback` type — synchronous `(api: PackRegistrationAPI) => void` per ADR-097 Q5.
  - `LoadedPack`, `LoadInstalledPacksOptions`, `InstalledPacksManifest` types.

  **`mmnto-ai/totem#1769` — ChunkStrategy registry extensibility.** New `packages/core/src/chunkers/chunker-registry.ts` replaces the closed `CHUNKER_MAP` keyed by the closed `ChunkStrategy` Zod enum. Built-in chunkers self-register at module load; pack callbacks add new strategies via `registerChunkStrategy`. The registry rejects:
  - Re-registration of the same strategy name (pack-vs-pack collision).
  - Registration of a built-in name (built-ins immutable).
  - Any registration after seal.

  `ChunkStrategySchema` migrates from `z.enum([...])` to `z.string().refine()` against the registry. The error message lists the registered set so misconfigured strategy names are diagnosable. `ChunkStrategy` type alias keeps the literal union of built-in names + adds `(string & {})` so IntelliSense survives in core code paths while pack-contributed strategies type-check.

  This supersedes `mmnto-ai/totem#1537` (which proposed adding `'rust-ast'` directly to the closed enum) — close `#1537` once PR-B (`@totem/pack-rust-architecture`) lands and registers `'rust-ast'` via the pack-side callback.

  **`mmnto-ai/totem#1653` — ast-grep `Lang` registration substrate (registry-backed reframe).** `packages/core/src/ast-classifier.ts` `extensionToLanguage` migrates from a hardcoded `switch` to a `Map`-backed registry. Built-in extensions (`.ts/.tsx/.jsx/.js/.mjs/.cjs`) self-register at module load; pack callbacks add new (extension, SupportedLanguage, wasmLoader) triples. `loadGrammar(lang)` consults the registry for the WASM loader thunk and memoizes the resolved grammar.

  `SupportedLanguage` type alias widens to `'typescript' | 'tsx' | 'javascript' | (string & {})` per the ADR-097 § 10 Q1 disposition: built-ins keep IntelliSense, pack-contributed languages flow through as registered strings.

  **Behavior change (mmnto-ai/totem#1653 fail-loud):** `applyAstRulesToAdditions` (`packages/core/src/rule-engine.ts:392`) previously silently skipped any file whose extension wasn't in the hardcoded mapping. The silent skip masked rules scoped to unmapped extensions — a `.rs` rule in LC's compiled-rules.json never fired with no signal. The fix is surgical: skip files only when NO rule's `fileGlobs` matches them (no rule cares → silent skip is correct); throw when a rule expected to run but the language isn't registered. Migration: install the pack that provides the language (e.g., `@totem/pack-rust-architecture` once PR-B lands), or correct the rule's `fileGlobs`.

  **`mmnto-ai/totem#1654` — compile-pipeline `Lang.Tsx` hardcode (partial fix, ride-along).** `packages/core/src/ast-grep-query.ts` `extensionToLang` migrates to consult the registry. Built-in mappings preserve napi `Lang` enum values (`Lang.TypeScript`, `Lang.Tsx`, `Lang.JavaScript`); pack-contributed languages flow through as their `SupportedLanguage` string per `@ast-grep/napi`'s `NapiLang = Lang | (string & {})` type.

  The second `#1654` call site (`packages/core/src/compile-lesson.ts:319` empty-root pattern validator) keeps `Lang.Tsx` for now as the lingua-franca syntactic-shape validator. Migrating that path requires per-rule language detection at validation time; deferred to a sibling PR. The registry shape proven end-to-end via the `extensionToLang` migration is sufficient to demonstrate non-TS rule dispatch.

  **Schema deltas:**
  - `TotemConfigSchema` gains optional `extends: z.array(z.string().min(1))` — formal validation of the pack-extends mechanism that `totem install` already wrote text-only. Pack-merge logic (`packages/core/src/pack-merge.ts`) reads pack rules; pack discovery (`packages/core/src/pack-discovery.ts`) reads this field plus `package.json` deps and writes the union to `.totem/installed-packs.json`.
  - `ChunkStrategySchema` migrates from `z.enum` to `z.string().refine(name => CHUNKER_REGISTRY.has(name), ...)`. Backward compatible at the type level: `ChunkStrategy` keeps the literal union of built-in names with `(string & {})` extension; runtime validation defers to the registry. Old data written before pack registration (all built-ins) parses cleanly.

  **`totem sync` integration:**

  `syncCommand` now writes `.totem/installed-packs.json` after the standard sync flow. The manifest payload is the deduplicated union of `package.json` `@totem/pack-*` deps and `totem.config.ts` `extends` entries (Q4 disposition). Mismatch surfaces emit per-pack warnings:
  - `dep-only`: pack in `package.json` but not in `extends` — pack-merge would never consume it. Skip with warning.
  - `extends-only`: pack in `extends` but not installed — engine cannot load it. Skip with warning.
  - `not-a-pack`: resolvable package without `peerDependencies['@mmnto/totem']` — doesn't follow the pack contract. Skip with warning.

  Resolved entries flow through to a strict-schema-validated manifest. Atomic write via temp file + rename mirrors `writeReviewExtensionsFile` (`mmnto-ai/totem#1527`).

  **`peerDependencies['@mmnto/totem']` engine version cross-check:** at boot, every pack's declared range is checked against the running engine version via `semver.satisfies` (per ADR-097 Q6). Mismatch produces a structured error: `"Pack '<name>' requires @mmnto/totem '<range>' but the running engine is <version>"`. Invalid range strings fail loud separately.

  **Test additions (50 new tests across 3 new test files):**
  - `packages/core/src/chunkers/chunker-registry.test.ts` (11 tests) — built-in registration, pack-style registration, conflict detection, seal contract.
  - `packages/core/src/pack-discovery.test.ts` (13 tests) — manifest read paths (missing / malformed / schema-invalid / unknown sibling keys), peerDeps mismatch (range fail / valid range pass / invalid range), re-load after seal, callback execution + registration, two-packs collision detection.
  - `packages/core/src/pack-manifest-writer.test.ts` (9 tests) — Q4 deduplication semantics, warning emission, atomic write, schema validity.
  - `packages/core/src/ast-classifier.test.ts` (extended +14 tests) — language registry built-ins, pack-style language registration, seal contract.
  - `packages/core/src/rule-engine.test.ts` (extended +3 tests) — `mmnto-ai/totem#1653` fail-loud behavior change: throws when rule scopes to unmapped extension; silent-skip preserved when no rule cares; unscoped rules don't trigger fail-loud.

  **Dependencies:**
  - `semver: ^7.7.0` added to `@mmnto/totem` dependencies for the engine version cross-check (per ADR-097 Q6). `@types/semver` to devDependencies.

  **PR cascade:**
  - This PR (PR-A) ships the substrate.
  - PR-B (`@totem/pack-rust-architecture` lift from `audits/internal/2026-04-30-pack-v0.1-draft/` to `packages/pack-rust-architecture/`) hard-blocks on this PR. PR-B authors the registration callback, ships `tree-sitter-rust.wasm`, and registers `'rust-ast'` ChunkStrategy + `.rs → 'rust'` Lang.
  - PR-C (LC adoption) follows post-PR-B.

### Patch Changes

- Updated dependencies [5f2b0f2]
  - @mmnto/totem@1.22.0

## 1.21.0

### Minor Changes

- 2ccef47: ADR-091 Stage 4 verification baseline overrides (`mmnto-ai/totem#1683`). Bundles three substrate fixes that all touch `packages/core/src/stage4-verifier.ts` overlapping surfaces:

  **`mmnto-ai/totem#1683` — T2 baseline overrides.** Adds the `review.stage4Baseline` config field (`{ extend: string[], exclude: string[] }`) and `# stage4-baseline: <glob>` `.totemignore` directives. The default test/fixture exclusions ship as `DEFAULT_BASELINE_GLOBS` (unchanged); consumers `extend` to add globs and `exclude` to remove default entries (e.g., a project that legitimately treats `tests/` as production source). Naming-discipline guard per the GCA finding logged in ADR-091 Deferred Decisions: the schema explicitly rejects an `allowlist` key with a pointer to `mmnto-ai/totem#1683` so a future regression surfaces at config-parse time, not in silent passthrough.

  **Public API additions (exported from `@mmnto/totem`):**
  - `resolveStage4Baseline(input: ResolveStage4BaselineInput): Stage4Baseline` — pure resolver. Composition order: `defaults ∪ ignoreDirectives ∪ configExtend ∖ configExclude`. Set-difference uses byte-equal glob comparison (so `exclude: ['**/tests/**']` removes that exact default entry). Filesystem access happens at the CLI integration boundary, not in the resolver.
  - `parseStage4BaselineDirectives(content: string): string[]` — pure parser for `# stage4-baseline: <glob>` lines. Regex: `/^#\s*stage4-baseline:\s*(.+?)\s*$/`. Skips empty/whitespace directive bodies silently.
  - `Stage4Baseline` interface extended with provenance fields (`extendedFromIgnoreFile`, `extendedFromConfig`, `excludedFromConfig`) for `totem doctor` (T4 / `mmnto-ai/totem#1685`) UX surfaces. The verifier itself only reads `excludeFileGlobs`.
  - `STAGE4_MANIFEST_EXCLUSIONS: readonly string[]` — see below.
  - `getDefaultBaseline()` is now a backward-compat shorthand for `resolveStage4Baseline({})`. Behavior unchanged.

  **`mmnto-ai/totem#1758` — matchesGlob → fileMatchesGlobs consolidation.** The Stage 4 verifier's local regex-conversion glob matcher had a substring hole (`**/tests/**` matched `src/contests/foo.ts` because the regex `.*tests/.*` doesn't anchor on segment boundaries). Consolidated onto `fileMatchesGlobs` from `rule-engine.ts` (now exported via the `@mmnto/totem` barrel + the existing `compiler.ts` re-export). The pattern-specific matcher anchors on segment boundaries by construction.

  The consolidation surfaced a separate latent bug in the rule-engine matcher: `**/dir/**` patterns recursed by stripping `**/` and then required the rest to match at path-root, so `**/__tests__/**` failed on `packages/cli/src/__tests__/foo.ts`. Fixed by walking every "/"-aligned tail of the path during the `**/` recursion. Three new regression tests on the rule-engine matcher.

  **`mmnto-ai/totem#1765` — manifest self-match exclusion.** The Stage 4 verifier intentionally strips `fileGlobs` so the rule fires on every file (in-scope AND baseline), then partitions afterward. Side effect: regex rules with a `badExample` field self-matched against their own entry in `.totem/compiled-rules.json`, routing every such rule to `outcome: 'out-of-scope'` regardless of real codebase risk. Demonstrated cleanly by the `mmnto-ai/totem#1761` AC #1 probe on LC's `init_resource` rule (3 legitimate in-scope hits, but the self-match short-circuited classification).

  Fix: `STAGE4_MANIFEST_EXCLUSIONS = ['.totem/compiled-rules.json']` exported constant. The CLI integration site filters this from `git ls-files` output before passing to `verifyAgainstCodebase`. The verifier itself stays a pure function whose contract is "verify the file set you're handed" — tests that pass synthetic file maps don't need the exclusion. `.totem/lessons*.md` carry the same self-match risk in principle but weren't surfaced by the AC #1 probe; adding them is a separate decision.

  **Schema deltas:**
  - `ReviewConfigSchema` (in `@mmnto/totem`) gains `stage4Baseline: Stage4BaselineConfigSchema.optional()`. Backward compatible: omitted field returns `undefined`, empty `{}` returns `{ extend: [], exclude: [] }`.
  - `Stage4BaselineConfigSchema` exported as a sibling of `ReviewConfigSchema`. Z-validates `extend` and `exclude` as `z.array(z.string()).default([])`. Rejects `allowlist` key via `superRefine` with an explicit error message.
  - `Stage4Baseline` (existing TS interface) gains three readonly provenance fields (above). Pre-existing constructions with only `excludeFileGlobs` need to migrate to `resolveStage4Baseline({...})` — done in the verifier's own test file as part of this PR.

  **CLI wiring:**

  `compileCommand` reads `.totemignore` once per compile run, parses directives, and composes the baseline via `resolveStage4Baseline(...)` with overrides from `config.review.stage4Baseline`. The cached baseline is reused across all rules in the batch. ENOENT on `.totemignore` is graceful (treated as no directives); other read errors propagate fail-loud per Tenet 4.

### Patch Changes

- Updated dependencies [2ccef47]
  - @mmnto/totem@1.21.0

## 1.20.0

### Minor Changes

- 4f73502: `totem spec` now writes to `.totem/specs/<topic>.md` by default (`mmnto-ai/totem#1555`). Closes a tier-1 silent contract gap with the `/preflight` skill, which expected the spec file to materialize automatically — 6+ confirmed occurrences in the wild before this fix (preflight on totem#1441, two LC dogfood sessions, three claude-0008/0009 totem sessions).

  **Behavior:**
  - **Default (single-input):** writes `<gitRoot>/.totem/specs/<stem>.md`, where `<stem>` is the issue number (for issue/URL/`owner/repo#NNN` invocations) or the sanitized free-form topic. Sanitization replaces any character outside `[a-zA-Z0-9_-]` with a single dash, collapses runs, and trims leading/trailing dashes — `totem spec "migration plan"` writes `.totem/specs/migration-plan.md`. Logs `Spec saved to <relative-path>` to stderr on success.
  - **`--out <path>`:** unchanged; writes to the exact path provided.
  - **`--stdout` (new):** opt back into the legacy stdout-only behavior for piping (`totem spec 123 --stdout | grep ...`). Mutually exclusive with `--out` — passing both fails with a `TotemConfigError` before any LLM call.
  - **Multi-input fallback:** when more than one input is passed and neither `--out` nor `--stdout` is set, the command falls back to stdout with a stderr hint suggesting `--out <path>`. Single-shot multi-input piping still works without surprise.
  - **Path traversal guard:** topic strings like `../../etc/passwd` sanitize to `etc-passwd`, so the resolved path stays under `<gitRoot>/.totem/specs/`.
  - **Monorepo safety:** path resolution uses `resolveGitRoot` from `@mmnto/totem`, so running `totem spec` from a sub-package writes to the repo-root specs directory, not a stray `packages/cli/.totem/specs/`.

  **Naming convention.** Argument pass-through is the only shape that survives both numeric and free-form invocations without a normalization layer — `totem spec 1682` → `.totem/specs/1682.md`, `totem spec my-topic` → `.totem/specs/my-topic.md`. Slug-derived filenames add a stale-slug failure mode when issues get renamed; numeric-only would break free-form topics.

  **Migration.** The default behavior change is a bug-fix-with-additive-escape-hatch (precedent: `mmnto-ai/totem#1747` discriminated-union shape change). Stdout-piping consumers add `--stdout`; preflight-skill consumers gain the file write they always expected.

### Patch Changes

- @mmnto/totem@1.20.0

## 1.19.0

### Minor Changes

- 9686817: ADR-091 Stage 4 Verify-Against-Codebase verifier (`mmnto-ai/totem#1682`). Headline 1.16.0 substrate. Before a compiled rule moves to Active status, it runs deterministically (zero LLM) against the consumer's working tree and is routed into one of four outcomes:
  - **No matches** → `status: 'untested-against-codebase'`. Verifier ran, found no hits in this codebase. Subsequent compile cycles in a populated repo can re-run Stage 4 and promote.
  - **Out-of-scope baseline match** → `status: 'archived'`, `archivedReason` cites the offending paths, new reasonCode `'stage4-out-of-scope-match'` added to `NonCompilableReasonCodeSchema`. Pattern is over-broad.
  - **In-scope `badExample`-shape match** → new `confidence: 'high'` field set. Pattern fires on real code in the exact authored shape.
  - **Candidate Debt** (in-scope but not bad-example shape) → force `severity: 'warning'` so the rule is alive but cannot break CI on first run; `totem doctor` (T4 / `mmnto-ai/totem#1685`) will surface the candidate-debt sites.

  T1 ships local-compile mode fully. The verifier walks the consumer's git-enumerated file set and reuses the existing `applyRulesToAdditions` / `applyAstRulesToAdditions` rule-engine surfaces; baseline glob matching mirrors the test-contract scope classifier shapes (`mmnto-ai/totem#1626` / `mmnto-ai/totem#1652`). Telemetry events tagged `type: 'stage4-verify'` append to `.totem/temp/telemetry.jsonl`.

  **Public API (new, exported from `@mmnto/totem`):** `verifyAgainstCodebase`, `getDefaultBaseline`, `DEFAULT_BASELINE_GLOBS`, type `Stage4VerificationResult`, type `Stage4Baseline`, type `Stage4Outcome`, type `Stage4VerifierDeps`. New optional `verifyStage4` callback on `CompileLessonDeps`; new optional `onStage4Outcome` callback on `CompileLessonCallbacks`. Schema deltas: `CompiledRuleSchema.status` enum gains `'untested-against-codebase'`, new optional `confidence` field, `NonCompilableReasonCodeSchema` gains `'stage4-out-of-scope-match'`.

  **Negative scope (deferred to follow-on tickets):** Pack install→lint promotion + `pending-verification` state writers + `.totem/rule-metrics.json` reads belong to T3 (`mmnto-ai/totem#1684`). Consumer `.totemignore` / `review.stage4Baseline` config field belongs to T2 (`mmnto-ai/totem#1683`). `totem doctor` Stage 4 surfaces belong to T4 (`mmnto-ai/totem#1685`). Batched / streamed perf optimizations belong to T5 (`mmnto-ai/totem#1686`). Pipeline 1 (manual) rules bypass Stage 4 — those are human-authored and self-evidencing.

  **Bot-review tail:** Sonnet pre-push review caught a defensive-coding gap on the candidate-debt severity downgrade (treating `undefined` severity as a no-op would let pre-1.16.0 persisted rules skip the downgrade if a future lint pass interpreted undefined as `'error'`). Tightened to `severity !== 'warning'` so the post-condition is explicit.

### Patch Changes

- Updated dependencies [9686817]
  - @mmnto/totem@1.19.0

## 1.18.3

### Patch Changes

- Updated dependencies [3e03fbf]
  - @mmnto/totem@1.18.3

## 1.18.2

### Patch Changes

- 8addc49: Promote `sanitizeForTerminal` helper from `@mmnto/cli` to `@mmnto/totem` core (`mmnto-ai/totem#1744`). MCP and other downstream consumers can now import the canonical helper directly from `@mmnto/totem` instead of duplicating the regex inline.

  Internal-only refactor: pure file relocation + import-path updates across 5 consumers (4 cli + 1 mcp). The MCP `context.ts` `strategyStatus.reason` rendering now calls `sanitizeForTerminal()` then applies the existing `\n`/`\t` flatten/collapse/trim chain inline (the helper deliberately preserves `\n`/`\t` for callers wanting multi-line content). Tests for the helper move with the source into `packages/core/`.

  The `cli/src/utils.ts` re-export of `sanitizeForTerminal` is dropped; consumers now import directly from `@mmnto/totem`. The orchestrator-graph guard in `shield-estimate.test.ts` continues to hold — `@mmnto/totem` core does not transit the orchestrator graph the way `cli/src/utils.ts` does via its static `./orchestrators/orchestrator.js` import.

- Updated dependencies [8addc49]
  - @mmnto/totem@1.18.2

## 1.18.1

### Patch Changes

- a32691f: chore: retire `.strategy/` git submodule (mmnto-ai/totem#1710 follow-up)

  Removes `.gitmodules` and the `.strategy` gitlink. The four-layer
  `resolveStrategyRoot` precedence shipped in mmnto-ai/totem#1710
  (`TOTEM_STRATEGY_ROOT` env → `TotemConfig.strategyRoot` → sibling clone
  at `../totem-strategy/` → legacy `.strategy/` submodule) makes the
  submodule path the LAST-resort fallback, and the auto-clone ceremony
  of `.gitmodules` was the only thing forcing every fresh totem checkout
  to fetch a strategy SHA from the gitlink.

  The resolver's Layer 4 (manual `.strategy/` directory) still works for
  existing checkouts that have one — the retirement is just removing the
  auto-clone wiring + the gitlink commit-pointer drift cycle.

  Recommended setup remains: clone `mmnto-ai/totem-strategy` as a sibling
  to your totem checkout. `CONTRIBUTING.md` already describes this; no
  doc change required.

  **Side updates:**
  - `.prettierignore`: drop the `.strategy/` entry (no directory to ignore).
  - `.gemini/styleguide.md`: rephrase a stale `.strategy/proposals/` doc
    reference to use `<strategyRoot>/proposals/` instead, with a parenthetical
    pointing at the resolver and the recommended sibling-clone path.

  **Note for existing local clones:** after pulling this PR, run
  `rm -rf .strategy .git/modules/.strategy` to clean the orphaned working
  tree. Git won't auto-prune a formerly-tracked submodule directory.
  - @mmnto/totem@1.18.1

## 1.18.0

### Patch Changes

- bea4cce: feat(consumers): port to `resolveStrategyRoot` (mmnto-ai/totem#1710)

  Builds on the `@mmnto/totem` resolver substrate. Each programmatic consumer
  of the strategy repo now reads through `resolveStrategyRoot` and degrades
  gracefully when the strategy root is unresolvable.

  **`@mmnto/mcp`:**
  - **Schema shape change (treated as minor — see rationale below):**
    `describe_project` rich-state `strategyPointer` payload flips from
    `{ sha, latestJournal }` to a discriminated union:
    `{ resolved: true, sha, latestJournal } | { resolved: false, reason }`.
    Agents that read the rich-state pointer must check `resolved` before
    reading `sha` / `latestJournal`. Only affects callers that opted in via
    `includeRichState: true` — the legacy slim payload is byte-identical.

    **Rationale for minor (not major):** (a) success-path is additive —
    the resolved branch preserves both `sha` and `latestJournal` fields;
    the failure-path now structures what was previously a pair of `null`s
    into a `{ resolved: false, reason }` envelope. (b) No known
    programmatic JSON consumers — the field is consumed across the totem
    ecosystem (mmnto-ai/totem, mmnto-ai/totem-strategy,
    mmnto-ai/totem-playground) exclusively as agent-rendered text via
    SessionStart hooks. (c) No queued cluster of breaking changes to ride
    alongside in a 2.0.0 bundle. The deferred-breaking-changes ledger
    (mmnto-ai/totem#1746) records this decision so the precedent stays
    visible; when that ledger reaches 2-3 substantive items, that bundle
    becomes 2.0.0.

  - **Auto-injected strategy linkedIndex.** `initContext` consults
    `resolveStrategyRoot` and prepends the resolved strategy path to the
    linkedIndexes iteration with a stable link name `'strategy'`. Boundary
    routing (`boundary: 'strategy'`) keeps working regardless of physical
    source (sibling / submodule / env override). Init-time warnings surface
    ONLY when the user explicitly signaled a strategy expectation (env or
    config); zero-config projects without a strategy repo skip silently.

  **`@mmnto/cli`:**
  - `totem proposal new` / `totem adr new` use `resolveStrategyRoot` and
    throw an actionable `TotemError(CONFIG_MISSING)` with a sibling-clone
    hint and `TOTEM_STRATEGY_ROOT` reference when unresolved (per the
    ADR-088 design rationale on actionable error UX). Standalone
    strategy-repo case (cwd IS the strategy repo) is detected before the
    resolver runs.
  - New `totem doctor` "Strategy Root" advisory diagnostic (`pass` /
    `warn`, never `fail`).
  - Bench scripts (`scripts/benchmark-compile.ts`, `scripts/bench-lance-open.ts`)
    hard-fail with actionable messages when the strategy root is unresolvable.

  **`totem.config.ts`:** the literal `linkedIndexes: ['.strategy']` is
  removed; the resolver is now the single source of truth for the strategy
  mesh path.

  **Documentation:** new `CONTRIBUTING.md` "Strategy Repo Expectations"
  section + `docs/architecture.md` update describing the configurable
  resolver.

  `.gitmodules` removal is a separate follow-up after this lands.

- Updated dependencies [bea4cce]
  - @mmnto/totem@1.18.0

## 1.17.1

### Patch Changes

- 21764b0: `totem review --estimate` gains a pattern-history overlay layer that reads `.totem/recurrence-stats.json` (the `mmnto-ai/totem#1715` substrate) and surfaces historically recurring uncovered patterns whose tokens are present in the diff additions above a 0.4 containment threshold. The overlay runs after the deterministic-rule pass, does not invoke the LLM, and degrades gracefully when the substrate is missing or malformed. Opt out per-invocation with `--no-history`.

  Closes mmnto-ai/totem#1731.
  - @mmnto/totem@1.17.1

## 1.17.0

### Minor Changes

- 6fd5271: `totem retrospect <pr>` — bot-tax circuit-breaker (mmnto-ai/totem#1713).

  Closes mmnto-ai/totem#1713. Reads a PR's bot-review history live, groups findings into push-based rounds via each review submission's `commit_id` (one round per push, not one round per submission), enriches each finding with cross-PR-recurrence flags read from `.totem/recurrence-stats.json` (mmnto-ai/totem#1715 substrate, read-only) plus rule-coverage flags read from `.totem/compiled-rules.json`, and emits a deterministic verdict per finding: `route-out`, `in-pr-fix`, or `undetermined`. The classifier is a fixed table over the four-axis cube `(severityBucket × roundPosition × crossPrRecurrenceBucket × coveredByRule)`; route-out reasons come from a closed catalog so the report doesn't accumulate one-off prose strings.

  No LLM. No GitHub mutation. Read-only outside the optional `--out <path>` JSON write. Sub-threshold runs exit 0 with a benign skip message; `--force` overrides. The no-LLM invariant is locked down by both a static-source-grep guard (mirrors `totem review --estimate` from mmnto-ai/totem#1714) and a runtime check that every dynamic import in the command file resolves to a non-LLM module.

  New CLI surface: `totem retrospect <pr-number>` with `--threshold <n>` (default 5), `--force`, `--out <path>`. Requires `gh` authenticated against the repo. The `--auto-file` flag proposed in the auto-spec is intentionally deferred to a follow-up ticket (mass-filing is irreversible; v0.1 emits suggested issue titles + bodies the human can copy-paste).

  New core surface: `RetrospectRoundSchema`, `RetrospectClassificationSchema`, `RetrospectFindingSchema`, `RetrospectReportSchema` plus pure helpers `groupFindingsByRound`, `classifyFinding`, `buildStopConditions`, `computeDedupRate`, `signatureOfBody`, `toRoundPosition`, `toCrossPrBucket`. `toSeverityBucket` is now exported from `@mmnto/totem` so the bot-tax cluster (`#1715` + `#1714` + `#1713`) shares one severity vocabulary. `GitHubCliPrAdapter` gains a `fetchReviews(prNumber)` method that reads `gh api repos/.../pulls/N/reviews --paginate` for `commit_id` + `submitted_at` (the existing `fetchPr` JSON shape doesn't include `commit_id`).

### Patch Changes

- Updated dependencies [6fd5271]
  - @mmnto/totem@1.17.0

## 1.16.1

### Patch Changes

- 296243b: `totem review --estimate` — pre-flight deterministic-rule estimator.

  Closes mmnto-ai/totem#1714. Adds `--estimate` to `totem review`: runs the same compiled-rule engine as `totem lint` against the diff resolved by `totem review`'s standard chain (`--diff` → `--staged` → working-tree → branch-vs-base) and returns immediately. No orchestrator, no embedder, no LanceDB — the entire LLM Verification Layer is structurally unreachable from this code path. Output is labeled `[Estimate]` (a new `ESTIMATE_DISPLAY_TAG` distinct from `[Review]`) so log lines unmistakably read as a forecast rather than a final verdict.

  Composes on top of mmnto-ai/totem#1715's `.totem/recurrence-stats.json` substrate as part of the bot-tax cluster (`#1713 totem retrospect`, `#1714 totem review --estimate`). The optional pattern-history overlay is filed separately as mmnto-ai/totem#1731.

  Mutually incompatible with `--learn`, `--auto-capture`, `--override`, `--suppress`, `--fresh`, `--mode`, and `--raw` — these only apply to the LLM path. The incompatibility guard fires before any other validation so the error message names the actual conflict (`--override is incompatible with --estimate`) rather than a misleading downstream constraint. Empty-diff runs do NOT stamp the `.reviewed-content-hash` push-gate cache: an estimate is a forecast, not a passing review.
  - @mmnto/totem@1.16.1

## 1.16.0

### Minor Changes

- 2d5b9ac: `totem stats --pattern-recurrence` — cross-PR recurrence clustering substrate.

  Closes mmnto-ai/totem#1715. Fetches bot-review findings (CodeRabbit + Gemini Code Assist) across the most recent merged PRs (`--history-depth`, default 50, capped at 200), folds in trap-ledger `override` events as co-equal signals, clusters them by a normalized signature (paths + line numbers + code-fence content stripped), filters out clusters covered by an existing compiled rule via Jaccard ≥ 0.6 keyword-overlap on the rule's `message`, and writes the surviving patterns at-or-above `--threshold` (default 5) to `.totem/recurrence-stats.json`. The console summary shows the top 5 by occurrence count.

  This is the substrate of truth for the upcoming `totem retrospect <pr>` (mmnto-ai/totem#1713 bot-tax circuit breaker) and `totem review --estimate` (mmnto-ai/totem#1714 pre-flight estimator) — patterns from those features will read this file rather than re-scan PR history per invocation.

  Output shape is versioned (`version: 1`), stable, and Zod-validated; consumers can parse against `RecurrenceStatsSchema` exported from `@mmnto/totem`. Atomic writes via temp + rename keep concurrent invocations safe.

### Patch Changes

- Updated dependencies [2d5b9ac]
  - @mmnto/totem@1.16.0

## 1.15.10

### Patch Changes

- 4bb87e2: `totem review` operator-dogfood bundle: override stamps the push-gate cache, plus an explicit `--diff <ref-range>` flag.
  - **mmnto-ai/totem#1716** — `totem review --override <reason>` now writes `.totem/cache/.reviewed-content-hash` after recording the override, so the push-gate hook unblocks immediately. Closes the tribal-knowledge `git reset --soft HEAD~1 && totem review --staged` workaround used since the override flag was added. New `recordShieldOverride` helper bundles the trap-ledger write and content-hash stamp into a single call site exercised by both the V2 structured-verdict path and the V1 fallback.
  - **mmnto-ai/totem#1717** — adds `totem review --diff <ref-range>` for explicit diff scope (e.g. `--diff HEAD^..HEAD`, `--diff main...feature`). Bypasses the implicit working-tree → staged → branch-vs-base fallback. The chosen diff source is logged to stderr (`Diff source: explicit-range`, `staged`, `uncommitted`, or `branch-vs-base`) so the operator's mental model matches the actual git invocation. Diffs exceeding 50,000 chars now surface a fail-loud truncation warning at the resolution layer — before the LLM call — so the operator can re-run with a narrower range instead of paying for a degraded review. The flag is documented in `--help`'s "Diff resolution" section. New `getGitDiffRange(cwd, range)` core helper rejects flag-injection ranges (leading `-`) and empty values; arg-array `safeExec` invocation prevents shell-metachar interpretation.

- Updated dependencies [4bb87e2]
  - @mmnto/totem@1.15.10

## 1.15.9

### Patch Changes

- e8792e5: fix(core): enable ast-grep verification in `verifyRuleExamples` (mmnto-ai/totem#1699)

  AI Studio corpus audit ([mmnto-ai/totem-strategy#150](https://github.com/mmnto-ai/totem-strategy/pull/150), B-Q4.1 / Q5 P2-1) finding. `verifyRuleExamples` short-circuited every non-regex rule via `if (rule.engine !== 'regex') return null;`, so ast-grep rules were never verified against their inline `**Example Hit:**` / `**Example Miss:**` blocks during compilation or via `totem rule test`. The downstream tester (`packages/core/src/rule-tester.ts`) already supports ast-grep through its `isAstGrep` branch — the entry point upstream of it was dropping the rule before the existing path could run.

  Real cases were slipping through this gap. Archived rule `e2341ed9229f9a60` shipped with pattern `new $ERROR($$$ARGS)`, matching every error class instantiation; the smoke-gate's bidirectional check (mmnto-ai/totem#1591) would have caught it at compile time if `verifyRuleExamples` had not blocked the engine.
  - **Guard narrowed.** Changed `if (rule.engine !== 'regex') return null;` to `if (rule.engine !== 'regex' && rule.engine !== 'ast-grep') return null;`. Tree-sitter (`engine: 'ast'`) stays skipped because `testRule`'s non-`ast-grep` branch routes through `applyRulesToAdditions`, which is the regex pipeline and does not handle S-expression queries.
  - **Tests.** Added two regression cases pinning the new behavior: ast-grep PASS on a matching badExample / non-matching goodExample, and ast-grep FAIL on the over-broad `new $ERROR($$$ARGS)` shape (the `e2341ed9229f9a60` exhibit class). The pre-existing test that asserted ast-grep returns null is rewritten to cover the Tree-sitter `'ast'` engine, which still legitimately short-circuits.
  - **No CLI surface change required.** `totem rule test <ast-grep-hash>` now returns PASS / FAIL against inline examples instead of warning "Engine 'ast-grep' does not support inline example testing." The compile-pipeline smoke gate (`compile-smoke-gate.ts`) inherits ast-grep coverage through the same entry point.

  Closes mmnto-ai/totem#1699.

- Updated dependencies [e8792e5]
  - @mmnto/totem@1.15.9

## 1.15.8

### Patch Changes

- d1e0bc2: fix(cli): switch triage-pr dedup identity to deterministic rootCommentId (#1666)

  Strategy upstream-feedback item 024 substrate. The previous `deduplicateFindings` used a `(file, line, body keyword Jaccard ≥ 0.3, line proximity ≤ 3)` fuzzy-merge heuristic. On `mmnto-ai/liquid-city#80` R3, GCA emitted six distinct high-severity findings on the same `(file, line)` anchor (all six anchored at the same rule-section start line because GitHub's pull-request inline-comment API requires a `line` field and GCA chose the rule-section header). The fuzzy merge collapsed all six into one entry, hiding five GCA-high findings from the triage summary.
  - **Strict-by-id dedup.** `deduplicateFindings` now uses `rootCommentId` as the primary dedup primitive. Two findings with different `rootCommentId` are ALWAYS distinct, even when bodies are byte-identical and they anchor at the same `(file, line)`.
  - **Body-hash fallback** for synthesized review-body findings (`extractReviewBodyFindings` emits these with `file === '(review body)'` and no `rootCommentId`). Map key is `(file, body)` directly — bounded length, no crypto cost, V8 handles long string keys natively.
  - **Cross-bot independence is now a feature.** When CR and GCA independently flag the same `(file, line)`, both findings surface so consumers can read the agreement as elevated-confidence signal (per the strategy bot-nuance file's "Cross-bot agreement = elevated finding confidence" pattern). The previous fuzzy merge silently masked that signal.
  - **`mergedWith` field stays on the schema, undefined in output.** Backward-compat shim so downstream display consumers don't need a coordinated rewrite.
  - **`extractKeywords` and `jaccardSimilarity` helpers retained as exports** for the deferred `--no-dedup` debug flag (#TBD-follow-up) and ad-hoc analysis scripts. No longer called by core dedup logic.

  Compile-pipeline failure mode shifts from "silent collapse of distinct findings" to "deterministic distinctness when API IDs differ." The 14 prior fuzzy-merge tests are rewritten to match the new semantics; the LC#80 R3 exhibit (6 distinct rootCommentIds on the same file:line) is pinned as a regression test.

  Closes the strategy upstream-feedback batch from `mmnto-ai/totem-strategy#133` — items 020 (#1663), 021 (#1664), 022 (Proposal 248), 023 (#1665), 024 (#1666) all complete.

- Updated dependencies [d1e0bc2]
  - @mmnto/totem@1.15.8

## 1.15.7

### Patch Changes

- 9e3214e: fix(core): emit `self-suppressing-pattern` reasonCode for self-suppressing skips (#1664)

  Strategy upstream-feedback item 021 substrate. Pre-fix, the compile worker silently dropped lessons whose compiled pattern would match `totem-ignore` / `totem-context` (and self-suppress at runtime) — the rejection mapped to `pattern-syntax-invalid` (a retry-pending code), so the lesson never landed in `nonCompilable`. Bot reviewers reading `compiled-rules.json` would synthesize "missing from manifest" findings because the audit trail was empty.
  - New `'self-suppressing-pattern'` member on `NonCompilableReasonCodeSchema`. Sibling to `'context-required'` (#1639) and `'semantic-analysis-required'` (#1640) — both are terminal classifier codes for structural incapacity.
  - Terminal write-policy: NOT in `LEDGER_RETRY_PENDING_CODES`, so `shouldWriteToLedger('self-suppressing-pattern')` returns true. Self-suppression is structural — the same lesson body would produce the same self-suppressing pattern on every retry, so retry-pending would loop forever.
  - `classifyBuildRejectReason` updated: rejection messages containing `'suppression directive'` now map to `'self-suppressing-pattern'` (was: `'pattern-syntax-invalid'`). Other rejection paths (`'Rejected regex'`, `'Invalid ast-grep pattern'`) keep their existing mappings.
  - Bot reviewers can now cite the explicit `reasonCode: 'self-suppressing-pattern'` entry in `nonCompilable` instead of inferring "this lesson is missing" from headcount mismatches.

- Updated dependencies [9e3214e]
  - @mmnto/totem@1.15.7

## 1.15.6

### Patch Changes

- 20c491c: fix(core+cli): honor source-declared `**Scope:**` over LLM emission on Pipeline 2/3 (#1665)

  Strategy item 023 substrate. Inverse of `mmnto-ai/totem#1626` (auto-ADD): the compile worker silently DROPPED test/spec exclusion globs (`!**/*.test.*`, `!**/*.spec.*`) that lessons declared in their `**Scope:**` line. Confirmed twice on `mmnto-ai/liquid-city#80` for rules `5bcc8aad9096c817` and `6c457c82d3945d15`.
  - New `parseDeclaredScope(body)` helper in `@mmnto/totem` that parses the lesson body's `**Scope:**` prose declaration into a glob list. Preserves `!`-prefixed exclusion entries verbatim and preserves authored order. Returns `undefined` for missing/empty/whitespace-only declarations.
  - New `isGlobSetEqual(a, b)` pure helper for set-of-strings comparison. Order-insensitive, duplicate-insensitive, sign-sensitive (`'!**/*.test.*'` does not equal `'**/*.test.*'`).
  - `extractManualPattern` (Pipeline 1) refactored to delegate Scope parsing to `parseDeclaredScope` so the manual flow shares a single source of truth with Pipeline 2/3.
  - `BuildCompiledRuleOptions.lessonBody?: string` opts callers into the override path. When supplied AND the body declares a `**Scope:**` line, the parsed source-Scope glob list takes precedence over `parsed.fileGlobs` regardless of LLM emission. Both lists pass through `sanitizeFileGlobs` for parity (shallow → recursive normalization).
  - `BuildRuleResult.scopeOverride?: { from: string[] | undefined; to: string[] }` reports the override event when the override actually changed the emitted globs. Threaded through rejection paths too. Mirrors `severityOverride` discipline from #1656.
  - New `onScopeOverride` callback on `CompileLessonCallbacks` wired to a `writeScopeOverrideTelemetry` closure in CLI `compile.ts` that records `type: 'scope-override'` entries to `.totem/temp/telemetry.jsonl`. Cloud-compile path also wired.
  - Author intent supreme: source-declared Scope overrides the LLM's emission AND the #1626 test-contract auto-include heuristic. The auto-include path stays active only when the lesson omits Scope.

  Compile pipeline failure mode shifts from "silent drop" to "deterministic override + telemetry on divergence." Strict-fail compile gate is deferred to a follow-up if telemetry reveals persistent LLM drift.

- Updated dependencies [20c491c]
  - @mmnto/totem@1.15.6

## 1.15.5

### Patch Changes

- aebf82f: feat(core+mcp): `applies-to` lesson frontmatter for role-of-code citation accuracy (#1663)

  Strategy item 020 substrate. Lesson frontmatter gains an `applies-to:` field carrying a closed role taxonomy (`mutator`, `boundary`, `aggregator`, `hot-path`, `boundary-test`, `infrastructure`, `presentation`, `any`) so downstream bot reviewers can filter lessons by role match instead of grep-by-topic heuristics.
  - New public exports from `@mmnto/totem`: `LessonRole`, `LessonRoleSchema`, `filterLessonsByRole`, `LessonWithAppliesTo`.
  - YAML and prose wire formats both supported. YAML accepts list (`applies-to: [mutator, boundary]`) and scalar (`applies-to: mutator`) forms; prose form is `**Applies-to:** mutator, boundary`. Mixed-case input is lowercased; empty arrays normalize to `['any']`; missing field defaults to `['any']`.
  - `mcp__totem-dev__add_lesson` gains an optional `applies_to` argument (snake_case at the MCP boundary, kebab-case in the on-disk frontmatter per item 020).
  - Pure `filterLessonsByRole(lessons, targetRole?)` utility exported for downstream consumers; `targetRole` undefined returns input unchanged, otherwise keeps lessons whose `appliesTo` includes the target OR `'any'`.
  - Backwards-compat: existing 1,159 lessons continue to parse with `appliesTo: ['any']` deterministically; no migration required.

  Bot-prompt integration and the function-role classifier are out of scope for this PR (see follow-up tickets at PR merge). Item 020 is the Proposal 248 (`mmnto-ai/totem-strategy#136`) substrate prereq for per-bot operations packs.

- Updated dependencies [aebf82f]
  - @mmnto/totem@1.15.5

## 1.15.4

### Patch Changes

- d295439: 1.15.4 bundles two compile-worker prompt classifier improvements that surfaced from downstream consumer friction on `mmnto-ai/liquid-city`. Both close fidelity gaps between the lesson prose authors wrote and the compiled rule that shipped.

  ## Test-contract scope classifier (closes #1626)
  - New `### Test-Contract Scope Classifier (mmnto-ai/totem#1626)` section on both `COMPILER_SYSTEM_PROMPT` and `PIPELINE3_COMPILER_PROMPT`. Teaches the compile-worker to recognize lessons whose hazard is **behavior inside test files** (assertion conventions, spy / mock contracts, test-fixture hygiene) and emit test-inclusive `fileGlobs` instead of the default `!**/*.test.*` exclusion.
  - Three positive signals classify a lesson as test-contract: the `testing` tag, test-framework calls in `badExample`/`goodExample` (`describe(`, `it(`, `test(`, `expect(`, `vi.mock(`, `jest.mock(`, `beforeEach(`, `afterEach(`, `vi.spyOn(`, `jest.spyOn(`), or lesson-body references to test-execution-specific behavior.
  - Broad test-inclusive glob set for test-contract rules: `["**/*.test.*", "**/*.spec.*", "**/tests/**/*.*", "**/__tests__/**/*.*"]`. Narrow test-scoped globs (e.g., `packages/e2e/**/*.spec.ts`) are preserved when the lesson clearly targets them.
  - False-positive trap guard: the word "contract" alone does NOT classify a lesson as test-scoped. Lessons titled "Define strict API Data Contracts" or "Versioning contracts for REST endpoints" describe application-surface invariants. Classification requires the `testing` tag OR test-framework code in the examples alongside any keyword match.

  **Downstream impact:** Two `liquid-city` rules (`"Normalize temp paths for cross-platform equality"`, `"Spy on logger contracts in tests"`) were shipping with scopes that excluded tests and silently never fired. A follow-up chore cycle (`totem compile --upgrade <hash>` per rule) retriages existing corpus against the new prompt.

  ## Declared severity override (closes #1656)
  - New `parseDeclaredSeverity(body: string)` helper exported from `@mmnto/totem`. Parses `**Severity:** error` / `Severity: warning` prose declarations from a lesson body and returns a normalized `'error' | 'warning' | undefined`. Tolerates common markdown and punctuation shapes: bold markers (`**`, `*`, `_`) on either side, backtick-wrapped values, trailing sentence punctuation (`.`, `,`, `;`, `:`, `!`, `?`), and combined shapes like `**Severity: error**.`. Strict enum equality follows the strip, so out-of-vocabulary tokens (`info`, `critical`) return `undefined`.
  - `buildCompiledRule` honors a new `declaredSeverityOverride` option on `BuildCompiledRuleOptions`. Post-LLM override wins over `parsed.severity` regardless of LLM emission. Marker fires in `BuildRuleResult.severityOverride` only when the override actually changed the outcome (declared value differs from `emittedSeverity ?? 'warning'`). Marker is threaded through rejection paths too, so telemetry captures prompt-drift even when the rule fails for other reasons.
  - New `onSeverityOverride` callback on `CompileLessonCallbacks` fires when the override changes the emitted severity. CLI `compile.ts` wires a `writeSeverityOverrideTelemetry` closure that appends records tagged `type: 'severity-override'` to `.totem/temp/telemetry.jsonl` via the cwd-aware `totemDir` (matches the `mmnto-ai/totem#1645` pattern). Fire-and-forget; sink failures do not interfere with compile results.
  - New `### Declared Severity (mmnto-ai/totem#1656)` directive section on both compile prompts instructs the LLM to honor prose-declared severity in its emitted JSON. Every Output Schema example and every concrete Lesson → Output few-shot example now carries `"severity": "warning"` (the default) to reduce drift at source.

  **Downstream impact:** Five `liquid-city` ADR-008 rules on PR 77 burned ~10 manual severity-edit commits across R2 + R3 rounds because the compile pipeline emitted `"severity": "warning"` despite lesson prose declaring `Severity: error`. The mechanical re-edit loop closes; the next `totem lesson compile` cycle on LC emits declared severity directly.

  ## Strategy submodule bump
  - `.strategy` submodule pointer advances from `113179c` to `7892892b`. Picks up strategy PR #125 (upstream-feedback items 015 + 016 from liquid-city session-17) and strategy PR #124 (upstream-feedback item 017 — three-layer language support gap addendum that documents the architectural surface of the pending Rust-support arc).

- Updated dependencies [d295439]
  - @mmnto/totem@1.15.4

## 1.15.3

### Patch Changes

- b782d4e: 1.15.3 bundles three compile-worker quality fixes and the runtime ReDoS defense. All three extend the ADR-091 Classify stage or harden the deterministic-enforcement path under `totem lint`.

  ## Bounded regex execution (closes #1641)
  - Runtime per-rule-per-file timeout on regex evaluation via a persistent Node worker thread. Catastrophic-backtracking patterns now terminate at the configured budget instead of hanging `totem lint`. Pre-exhibit defense against a ReDoS attack chain that survives every prior gate (`safe-regex` static check, bidirectional smoke gate, human promotion review).
  - `totem lint --timeout-mode <strict|lenient>` — new flag on the lint command. `strict` (default) fails non-zero on any timeout; `lenient` skips the offending rule-file pair with a visible warning. Strict mode is the CI path.
  - New `packages/core/src/regex-safety/` module (`evaluator.ts`, `worker.ts`, `apply-rules-bounded.ts`, `telemetry.ts`). Async `applyRulesToAdditionsBounded` sibling to the sync path, policy-free — returns `{violations, timeoutOutcomes}` and lets the CLI apply strict-vs-lenient exit-code policy.
  - Telemetry: every terminal outcome (match, no-match, timeout, syntax error) writes a `type: 'regex-execution'` record to `.totem/temp/telemetry.jsonl`, Zod-validated against `RegexTelemetrySchema` with repo-relative path redaction (paths outside the repo root become `<extern:<sha256-12>>`).
  - Race-condition hardening baked in: `respawnPromise` coalesces concurrent respawn requests, `MAX_CONSECUTIVE_RESPAWNS` guards against infinite spawn loops on a permanently-broken worker, and a cold-start gate prevents the 100ms default from misfiring under CI load.

  ## Context-required classifier (closes #1598)
  - New `reasonCode: 'context-required'` route on the compile-worker output schema. Lessons whose hazard is scope-bounded by a context the pattern cannot structurally capture (e.g., `"sim.tick() must not advance inside _process"`) now route to the `nonCompilable` ledger instead of compiling into false-positive-prone rules.
  - Narrow LLM-emittable enum on `CompilerOutputBaseSchema.reasonCode` (not the full `NonCompilableReasonCodeSchema`), preventing the LLM from forging internal codes like `verify-retry-exhausted`. Extends ADR-091's Classify stage.
  - New **Context Constraints Classifier** section on the compile prompt with marker heuristics (inside / when / only-for-new / must-not) and an explicit **anti-lazy** rule-of-thumb: compilation MUST still succeed when `fileGlobs` / ast-grep `kind:` / `inside:` / `has:` / `regex:` combinators can express the guard.

  ## Semantic-analysis classifier + ledger hygiene

  Closes #1634 + #1627.
  - Extends the narrow `reasonCode` enum with `'semantic-analysis-required'` covering four sub-classes: multi-file contracts, closure-body AST analysis, system-parameter-aware scoping, project-state-conditional semantics. Sub-class carried in the prose `reason`; one consolidated code keeps the LLM contract tight.
  - Pipeline 2 and Pipeline 3 `!parsed.compilable` branches switch from per-code conditional checks to `parsed.reasonCode ?? 'out-of-scope'`. Future narrow classifiers thread through without per-code switches.
  - `LEDGER_RETRY_PENDING_CODES` set + `shouldWriteToLedger(reasonCode)` predicate exported from `@mmnto/totem`. CLI ledger guard now rejects writes for retry-pending codes (`pattern-syntax-invalid`, `pattern-zero-match`, `verify-retry-exhausted`, `missing-badexample`, `missing-goodexample`, `matches-good-example`) so transient smoke-gate rejections no longer permanently mark lessons as unfit.
  - Symmetric stale-entry prune on both compiled branches (local + cloud) when a lesson compiles cleanly, and on cloud smoke-gate rejection. Cleaned three stale `matches-good-example` entries from the shipped ledger.

- Updated dependencies [b782d4e]
  - @mmnto/totem@1.15.3

## 1.15.2

### Patch Changes

- 1c766c2: 1.15.2 ships the archive-in-place durability substrate from #1587 and the new `totem lesson archive` atomic command.

  ## Governance durability (closes #1587)
  - `totem lesson compile --refresh-manifest` — new no-LLM primitive that recomputes `compile-manifest.json` output_hash from the current `compiled-rules.json` state. Closes the postmerge inline-archive gap where the no-op compile path only detected input-hash drift. Strict exclusivity with `--force`.
  - `totem lesson compile --force` now preserves `status`, `archivedReason`, and `archivedAt` additively on rules whose `lessonHash` survives to the new output. Transient compile failures (network / rate-limit / manual reject / example-verification / cloud parse) leave the old rule intact instead of silently dropping it. Implemented via the new `preserveLifecycleFields` helper in core and `upsertRule` / `removeRuleByHash` helpers in the CLI compile loop (replace-by-hash on success; remove-on-skipped; unchanged on failed / noop). Dangling-archive guard preserved — rules whose source lesson was deleted are never resurrected.
  - `totem lesson archive <hash> [--reason <string>]` — new atomic command mirroring `totem rule promote`. Flips the rule's `status` to `archived`, stamps `archivedAt` on first transition, preserves `archivedAt` on reruns, refreshes the manifest, and regenerates copilot + junie exports — all in one call. Matches prefix on `lessonHash`; duplicate-full-hash collisions surface as data-corruption errors distinct from prefix ambiguity.
  - `/postmerge` skill doc rewritten to call `totem lesson archive` directly, retiring the hand-rolled `scripts/archive-bad-postmerge-*.cjs` pattern.

- Updated dependencies [1c766c2]
  - @mmnto/totem@1.15.2

## 1.15.1

### Patch Changes

- e69edb2: 1.15.1 ships the `totem proposal new` and `totem adr new` scaffolding commands that close out #1288.

  ## Governance authoring (closes #1288)
  - `totem proposal new <title>` scaffolds a new strategy proposal at `.strategy/proposals/active/NNN-kebab-title.md` with the canonical template (Status / Author / Date / Milestone + Motivation / Problem Statement / Proposed Solution / Consequences / Decision Needed).
  - `totem adr new <title>` scaffolds a new ADR at `.strategy/adr/adr-NNN-kebab-title.md` with the Format B convention (`# ADR NNN: Title`, Status / Context / Decision / Consequences).
  - Both commands auto-increment the number by scanning the target directory, collision-check before any disk writes, and warn-and-continue on post-scaffold hooks so partial failures do not leave orphan files.
  - Runs `pnpm run docs:inject` automatically when the project has that script configured, so the `PROPOSAL_INBOX` and `ADR_TABLE` dashboards in README.md refresh without manual intervention.
  - New orchestrator at `packages/cli/src/utils/governance.ts` with 5 helpers and 2 default templates. 34 new tests covering slug validation, collision detection, number inference, template selection, and hook degradation.
  - `@totem/pack-agent-security` allowlist updated for the 2 legitimate `spawn` sites the new commands introduce.

- Updated dependencies [e69edb2]
  - @mmnto/totem@1.15.1

## 1.15.0

### Minor Changes

- f9c287b: 1.15.0 ships Pack Distribution: the first shippable Totem pack, plus the compile-hardening and zero-trust substrate that makes packs safe to distribute.

  ## Pack Distribution
  - `@totem/pack-agent-security` (ADR-089 flagship pack). 5 immutable security rules covering unauthorized process spawning, dynamic code evaluation with non-literal arguments, network exfiltration via hardcoded IPs or suspicious domains (API + shell-string variants), and obfuscated string assembly via byte-level primitives. Every rule ships `immutable: true` + `severity: error` + `category: security` with bad/good fixture pairs and 57 unit tests.
  - `totem install pack/<name>` command installs a published pack into the local manifest.
  - `pack-merge` primitive refuses downgrade of immutable rules to warning or archived; bypass attempts log to the Trap Ledger.
  - Content-hash substrate across TypeScript and bash (review + sync + pre-push hook) so pack integrity verifies without relying on file timestamps.

  ## Zero-trust default (ADR-089)
  - Pipeline 2 and Pipeline 3 LLM-generated rules now ship `unverified: true` unconditionally. Activation via the atomic `totem rule promote <hash>` CLI or the ADR-091 Stage 4 Codebase Verifier in 1.16.0.
  - Pipeline 1 (manual) keeps its conditional semantics; human-authored rules are self-evidencing.

  ## Compile hardening (ADR-088 Phase 1)
  - Layer 3 verify-retry loop: rules that fail their own smoke test re-prompt once before the compiler rejects them.
  - Compile-time smoke gate runs both `badExample` and `goodExample`; rules that fire on both directions are rejected with reason code `matches-good-example` (closes the over-matching hole that drove the 2026-04-18 security-pack 10-of-10 archive rate).
  - `archivedAt` timestamp preserved across schema round-trips so the institutional first-archive-provenance ledger survives every compile cycle.
  - `unverified` flag and `nonCompilable` 4-tuple with 9-value reason-code enum replaces the opaque 2-tuples.
  - `totem doctor` stale-rule advisory (ADR-088 Phase 1) plus the grandfathered-rule advisory that surfaces the pre-zero-trust cohort categorized by `vintage-pre-1.13.0`, `no-badExample`, and `no-goodExample`.

  ## Platform
  - Compound ast-grep rules (ADR-087, promoted from Proposal 226). `astGrepYamlRule` field on `CompiledRule` with mutual exclusion on `astGrepPattern`, structural combinators (all / any / not / inside / has / precedes / follows), and canonical-serialization hashing via `canonicalStringify`.
  - Windows shell-injection fix in `safeExec` via `cross-spawn.sync` (closes a three-week-latent vector).
  - Cross-Repo Context Mesh (`totem search` federation + `totem doctor` Linked Indexes health check).
  - Standalone binary distribution unblocked (darwin-arm64, linux-x64, win32-x64).

  ## Positioning
  - **ADR-090 (Multi-Agent State Substrate).** Scopes Totem as the shared state, enforcement, and audit substrate for multi-agent development. Totem does not own agent routing, capability negotiation, session lifecycle, or live-edit conflict resolution. Future feature admission passes the Scope Decision Test.
  - **ADR-091 (Ingestion Pipeline Refinements).** Redefines the 1.16.0 ingestion pipeline as a 5-stage funnel: Extract → Classify → Compile → Verify-Against-Codebase → Activate. Renames the legacy `allowlist` terminology to `baseline`.
  - **ADR-085 (Pack Ecosystem).** Accepted with five deferred decisions resolved: Behavioral SemVer with refinement classification, array-order precedence plus `totem doctor` shadowing warning, Local Supreme Authority with ADR-089 immutable-severity carve-out, Sigstore + in-toto signing, native npm lifecycle with 72-hour unpublish constraint.

  Detailed patch-level changes: CHANGELOG.md entries 1.14.1 through 1.14.17.

### Patch Changes

- Updated dependencies [f9c287b]
  - @mmnto/totem@1.15.0

## 1.14.17

### Patch Changes

- e449910: Add `totem doctor` Grandfathered Rules advisory (mmnto-ai/totem#1603, part 2 of #1581).

  Surfaces the pre-zero-trust cohort (active rules without the ADR-089 `unverified` flag) categorized by reason code:
  - `vintage-pre-1.13.0` — rule compiled before the 1.13.0 ship date
  - `no-badExample` — absent or empty `badExample` substrate field
  - `no-goodExample` — absent or empty `goodExample` substrate field

  On the current corpus the advisory reports 378 grandfathered rules (358 vintage-pre-1.13.0, 371 no-badExample, 378 no-goodExample). This is the mechanically true state; categorization gives users a triage-able surface.

  Advisory-only (`status: 'warn'`). ADR-091 Stage 4 Codebase Verifier (1.16.0, mmnto-ai/totem#1504) is the empirical audit path — that verifier runs rules against actual code and does not depend on the substrate snippet fields the legacy cohort lacks. The `doctor` advisory holds the position until Stage 4 ships.

  Final item of the 1.15.0 compile-hardening ship gate.
  - @mmnto/totem@1.14.17

## 1.14.16

### Patch Changes

- b7f298c: Ship the ADR-089 zero-trust default and the `totem rule promote` CLI (mmnto-ai/totem#1581, part 1 of 2).

  **Zero-trust default (core):** every LLM-generated rule now ships `unverified: true` unconditionally. Pipeline 2 (verify-retry loop) and Pipeline 3 (Bad/Good example-based) both flip from the pre-#1581 conditional behavior (keyed on Example Hit presence) to unconditional. Pipeline 1 (manual) keeps its pre-#1581 conditional semantics because manual rules are human-authored and self-evidencing; the existing Pipeline 1 Example-Hit guard stays as a safety net.

  Rationale: the LLM cannot self-certify structural invariants. Example Hit/Miss is an LLM-produced artifact of the compile process, not a human sign-off. Activation requires either human promotion via the new CLI below OR the ADR-091 Stage 4 Codebase Verifier in 1.16.0 (which validates rules empirically against actual code, not against LLM-generated snippet fixtures).

  **`totem rule promote <id>` CLI:** flips a rule's `unverified: true` flag to absent (canonical "verified" state), atomically refreshes `compile-manifest.json`'s `output_hash` so `verify-manifest` passes on the next push. Refuses to promote archived rules and refuses when the target rule is already verified. Exits 1 on ambiguous prefix matches with a disambiguation list.

  Hand-editing `compiled-rules.json` to flip `unverified` would break the manifest hash and trip the pre-push `verify-manifest` gate. The promote command is the blessed path; the atomic refresh closes that user trap at source.

  **Scope split:** the "Option 1 + Categorized Advisory" plan locks the 1.15.0 ship gate via this PR. The categorized `totem doctor` advisory that surfaces the 357 grandfathered pre-1.13.0 rules by reason lands as a follow-up PR on a separate branch to keep the reviewable surface tight.

  Closes #1581 (part 1).

- 358336e: Add `archivedAt` to `CompiledRuleBaseSchema` so Zod stops silently stripping it on round-trips (mmnto-ai/totem#1589).

  Pre-#1589, the schema declared `status`, `archivedReason`, `badExample`, `goodExample`, and a half-dozen other lifecycle fields — but not `archivedAt`. Zod's default behavior strips unknown keys during parse/serialize. Every compile-write cycle that round-tripped `compiled-rules.json` through `CompiledRulesFileSchema.parse()` silently erased prior `archivedAt` values from archived rules. Postmerge archive scripts (`scripts/archive-postmerge-*.cjs`) set the field via raw JSON mutation; it survived on disk until the next `totem lesson compile --export` quietly rewrote the file. Observed on PR #1588 (rule `4b091a1bc7d286d6`, archived 2026-04-19, timestamp lost during postmerge re-export). GCA caught the drop and we restored the timestamp manually; this ticket prevents future losses at the schema level.

  The field is declared `z.string().optional()` for backward compatibility with pre-#1589 manifests that never had the field populated. Existing call sites continue to work unchanged.

  Four new tests in `compiler-schema.test.ts` pin the invariant: accepts a rule with `archivedAt` set, preserves the field across a full parse → serialize → parse round-trip, tolerates an active rule without the field, and preserves the full archive tuple (`status` + `archivedReason` + `archivedAt`) together.

  Closes #1589.

- Updated dependencies [b7f298c]
- Updated dependencies [358336e]
  - @mmnto/totem@1.14.16

## 1.14.15

### Patch Changes

- 89ca890: Extend the compile-time smoke gate with an over-matching check via `goodExample` (mmnto-ai/totem#1580).

  The gate now verifies both directions: the rule MUST match its `badExample` (under-matching check, in place since #1408) AND MUST NOT match its `goodExample` (over-matching check, new). A rule that fires on both sides is over-broad and produces false positives on every lint run, which was the dominant defect class observed in the 2026-04-18 security-pack postmerge incident (10-of-10 bad rate from #1526).

  `CompilerOutputSchema.goodExample` flips from optional to engine-conditional required for regex and ast-grep engines, mirroring the #1420 flip for `badExample`. The `ast` engine (Tree-sitter S-expression queries) remains exempt because the smoke gate does not yet evaluate those. `CompiledRuleSchema.goodExample` stays optional on the persisted-rule boundary for backward compat with pre-#1580 rules.

  Two new reason codes added to `NonCompilableReasonCodeSchema`: `matches-good-example` (over-match rejection) and `missing-goodexample` (defensive path for callers that bypass the schema refine). Rejected lessons surface in the `nonCompilable` ledger with the correct code so `totem doctor` and downstream telemetry can distinguish over-match rejections from other skip categories.

  Pipeline 3 automatically threads the lesson's Good snippet through as `goodExampleOverride`; Pipeline 2 requires the LLM to emit `goodExample` alongside `badExample` via the updated compiler prompt. Pipeline 1 (manual) is unaffected — the gate is opt-in via `enforceSmokeGate`.

  Closes #1580.

- Updated dependencies [89ca890]
  - @mmnto/totem@1.14.15

## 1.14.14

### Patch Changes

- e073dc0: Flip Pipeline 5 auto-capture on `totem review` from opt-out to opt-in.

  `--no-auto-capture` is renamed to `--auto-capture`; the default is now OFF. Observation rules captured from review findings are context-less (regex drawn from the flagged line, message taken from the reviewer, `fileGlobs` scoped to the whole codebase) and routinely pollute `compiled-rules.json` with rules that fire on unrelated files. The Liquid City Session 6 audit measured an 8-rule wave across 5 review invocations producing 13 new warnings on the next `totem lint`, up from 0.

  To preserve the old behavior, pass `--auto-capture` explicitly. Auto-capture will resume as a default once ADR-091 Stage 2 Classifier + Stage 4 Codebase Verifier ship in 1.16.0 and the LLM-emitted rule loop has gates that prevent context-less emissions.

  Closes #1579.

- Updated dependencies [e073dc0]
  - @mmnto/totem@1.14.14

## 1.14.13

### Patch Changes

- 8dd8dc8: core: thread per-invocation `RuleEngineContext` through the rule engine

  Removes the module-level `let coreLogger` / `let shieldContextDeprecationWarned` state from `rule-engine.ts` and replaces the hidden DI setter (`setCoreLogger` / `resetShieldContextWarning`) with a required `RuleEngineContext` parameter on `applyRulesToAdditions`, `applyAstRulesToAdditions`, `applyRules`, and `extractJustification`. Concurrent or federated rule evaluations cannot bleed logger wiring or deprecation-warning latching across each other. Closes mmnto-ai/totem#1441.

  **Breaking:** `setCoreLogger` and `resetShieldContextWarning` are removed from `@mmnto/totem`. Callers must build a `RuleEngineContext` once per linting invocation and pass it as the first argument to the affected functions. See the README or the `RuleEngineContext` JSDoc for the shape.

- Updated dependencies [8dd8dc8]
  - @mmnto/totem@1.14.13

## 1.14.12

### Patch Changes

- dad363b: ADR-088 Phase 1 Layer 4 substrate: compile --verbose trace + doctor stale-rule advisory.

  `totem compile --verbose` emits a structured per-lesson layer-trace block
  that shows which pipeline the lesson took, the generated pattern hash,
  verify outcome, retry scheduling, and the terminal result plus reasonCode
  on skip. Output ships via a single `process.stdout.write` per lesson so
  concurrent compiles do not interleave within a block. The trace is
  produced unconditionally on `CompileLessonResult.trace` across all three
  pipelines (layer 1 manual, layer 2 example-based, layer 3 Layer 3 LLM
  with verify-retry); callers that do not pass `--verbose` pay only the
  cost of a small per-lesson array.

  `RuleMetric` gains an `evaluationCount` field. `runCompiledRules`
  increments it exactly once per rule per lint run, regardless of how many
  matches fire. Pre-#1483 rule-metrics.json files load with the new field
  defaulted to zero via Zod, so the migration is transparent.

  `totem doctor` adds a stale-rule advisory that flags active rules whose
  cumulative `evaluationCount` has crossed a configurable window while
  `contextCounts.code` stayed at zero. Security rules (category=security
  OR immutable=true) land with a higher-severity label and the advisory
  declines to recommend archival for them; standard rules get both
  `totem compile --upgrade <hash>` and archival as recovery paths.
  `TotemConfig.doctor.staleRuleWindow` (default 10) gates the check. v1
  uses cumulative-lifetime semantics; #1550 tracks the rolling-window
  upgrade via `RuleMetric.runHistory` ring buffer, behind the same config
  key so no user migration is needed.

  Advisory only: no auto-archive, no mutation to the rules file. The
  existing `totem doctor --pr` autonomous minAgeDays GC path is untouched.

  Closes #1482. Closes #1483.

- 1107f24: ADR-088 Phase 1 Layers 3 and 4 substrate: unverified flag and reason codes.

  `CompiledRule` gains an optional `unverified: boolean` field, set to `true`
  when the rule was compiled from a lesson lacking a non-empty Example Hit
  block. Pipeline 1 (manual), Pipeline 2 (LLM), and Pipeline 3 (example-based)
  all flag the rule rather than shipping a pattern with no ground truth.
  Security-scoped lessons (`deps.securityContext === true` or a manual rule
  with `immutable: true`) reject outright instead of flagging, per the
  Decision 3 zero-tolerance policy. Absence of the field preserves pre-#1480
  manifest hashes via `canonicalStringify`; the literal `false` is never
  written.

  The `nonCompilable` ledger upgrades from `{hash, title}` to the 4-tuple
  `{hash, title, reasonCode, reason?}`. `reasonCode` is one of
  `no-pattern-generated`, `pattern-syntax-invalid`, `pattern-zero-match`,
  `verify-retry-exhausted`, `security-rule-rejected`, `no-pattern-found`,
  `out-of-scope`, `missing-badexample`, or `legacy-unknown`. The loader
  accepts all three historical shapes (string, 2-tuple, 4-tuple) and
  normalizes legacy rows to `reasonCode: 'legacy-unknown'`; the writer
  enforces the 4-tuple via a strict `NonCompilableEntryWriteSchema`.
  `saveCompiledRulesFile` validates every entry before serialization and
  throws on schema mismatch, following the lesson 400fed87 Read/Write
  invariant.

  Pipeline 2 validator rejections (invalid regex, unparseable ast-grep) and
  LLM-response parse failures move from the `failed` bucket to `skipped`
  with an explicit reasonCode so ADR-088 Layer 4 telemetry sees every
  outcome. `compile.ts` `nonCompilableMap` now carries the full 4-tuple
  through the run, and `install.ts` pack-merge routes writes through
  `saveCompiledRulesFile` so pack installs also go through the Write
  schema gate.

  Closes #1480. Closes #1481.

- Updated dependencies [dad363b]
- Updated dependencies [1107f24]
  - @mmnto/totem@1.14.12

## 1.14.11

### Patch Changes

- fc0d367: Config-driven source-extension list for the review content hash.

  Polyglot repos can now override the historical `['.ts', '.tsx', '.js', '.jsx']` set by declaring `review.sourceExtensions` in `totem.config.ts`. The CLI writes the validated set to `.totem/review-extensions.txt` on every `totem sync`, and `.claude/hooks/content-hash.sh` reads it so both implementations stay in lockstep. Defaults are unchanged; consumers who do not set the field see no behavior difference. Closes #1527 and #1529.

- Updated dependencies [fc0d367]
  - @mmnto/totem@1.14.11

## 1.14.10

### Patch Changes

- Updated dependencies [84bba42]
- Updated dependencies [6776b11]
  - @mmnto/totem@1.14.10

## 1.14.9

### Patch Changes

- Updated dependencies [e96599e]
  - @mmnto/totem@1.14.9

## 1.14.8

### Patch Changes

- Updated dependencies [bcc9c72]
  - @mmnto/totem@1.14.8

## 1.14.7

### Patch Changes

- Updated dependencies [cb51b59]
  - @mmnto/totem@1.14.7

## 1.14.6

### Patch Changes

- Updated dependencies [6b58563]
  - @mmnto/totem@1.14.6

## 1.14.5

### Patch Changes

- Updated dependencies [bd63810]
  - @mmnto/totem@1.14.5

## 1.14.4

### Patch Changes

- 12115e9: Refresh `compile-manifest.json` on pure input-hash drift (#1337)

  `totem lesson compile`'s no-op branch (introduced in #1281) refreshed the manifest only when `rulesPruned > 0 || drained > 0`. That left a gap: if a user deleted a lesson file whose rule was already absent from `compiled-rules.json` — or edited the lesson set in any way that produced zero prune/drain churn but shifted the `lessonsDir` hash — the manifest's `input_hash` stayed stale. `totem verify-manifest` then failed on the next `git push`, and the only recovery was `totem lesson compile --force` (~19 minutes of non-deterministic LLM calls on a mid-size repo).

  The no-op branch now explicitly compares `generateInputHash(lessonsDir)` against the existing manifest's `input_hash` and refreshes the manifest on drift, even when no rules were pruned. The refresh is carefully partitioned: `compiled-rules.json` is still rewritten only when actual pruning happened, so a pure drift refresh does not spuriously touch the rules file or invalidate downstream mtime-based caches.

  Missing or invalid `compile-manifest.json` is also handled — `readCompileManifest` wraps `ENOENT` via `readJsonSafe` into `TotemParseError` today, and a defensive raw-ENOENT fallback guards against future refactors of the core API. The missing-manifest path is locked in by an integration test in `compile-noop-refresh.test.ts`.

- Updated dependencies [55a7e19]
  - @mmnto/totem@1.14.4

## 1.14.3

### Patch Changes

- Updated dependencies [0b3e274]
  - @mmnto/totem@1.14.3

## 1.14.2

### Patch Changes

- e022109: Use `[Review]` as the log prefix for `totem review` output (#1335)

  The `totem review` command was still printing `[Shield]` as the log prefix on every status line — a holdover from before the `shield` → `review` rename. Added a new `DISPLAY_TAG = 'Review'` constant in `shield-templates.ts` and routed every `log.info` / `log.dim` / `log.warn` / `log.success` call through it. The existing `TAG = 'Shield'` constant is kept verbatim because it's still used as the lookup key for `orchestrator.overrides.shield` and `orchestrator.cacheTtls.shield` in user configs — a coordinated rename of the routing key is tracked in #1335.

  User-visible effect: `totem review` output now prints `[Review]` instead of `[Shield]`. No config migration required.
  - @mmnto/totem@1.14.2

## 1.14.1

### Patch Changes

- 30971d7: Prune stale `nonCompilable` entries on no-op compile runs (#1281)

  `totem lesson compile` was only draining stale entries from the `nonCompilable` cache when there was actual compile work to do. On a no-op run (all lessons already compiled), stale entries — left over from lessons that had been edited or removed in a previous run — survived forever until some future run happened to have real work.

  The prune logic is now extracted into a pure helper (`pruneStaleNonCompilable`) and called from both branches. The no-op path only rewrites `compiled-rules.json` when there's actually something to drain, so genuinely idle runs still don't touch the file.

  Closes #1281. Discovered during the #1264 E2E reproduction.

- b76128e: 1.14.1 — Hotfix sweep (#1311)

  Bundled fixes for four post-1.14.0 regressions surfaced during the first day of 1.14.0 in production:
  - **#1304** — `totem review` and `totem lint` were running rules against on-disk content instead of staged content when files had unstaged modifications. The rule engine now loads staged blob content via `git show :path` when a path is in the index, and reads from the filesystem only when the path is unstaged. Path containment is also hardened to reject symlinks that escape the repo root.
  - **#1305** — `lance-search` predicates were failing on any field name containing a SQL keyword or dash (`source-repo`, `file-type`) because the generated `WHERE` clause lacked backtick quoting. Field identifiers are now backtick-wrapped consistently.
  - **#1306** — AST engine test coverage audit found an uncovered branch in `ast-query` that silently returned an empty result set for malformed tree-sitter query strings. It now throws a descriptive error so `totem compile` can surface the broken rule instead of silently dropping it.
  - **#1309** — `totem doctor` and `totem lint` were still printing the legacy `totem review --fix` hint after that flag was removed in 1.12. Updated to the current `totem review --apply` form.

- b76128e: Queue drain: Shield branding consistency (#1313)

  Three small queue-drain items bundled into one PR (#1298, #1299, #1302):
  - **#1298** — `totem shield` output and `totem --help` entries now consistently use "Shield" branding instead of the legacy "AI Shield" and "shield" mix that had crept in over several releases.
  - **#1299** — `/preflight` skill doc-scope expanded to cover the cases where preflight was routinely producing "draft from memory" outputs instead of searching the knowledge base first.
  - **#1302** — Dual-hash convention documented in `.gemini/styleguide.md` so cross-agent review produces consistent pattern/content hash formatting.

- b76128e: Resolve non-staged AST paths against repo root, not cwd (#1314)

  `totem review` was resolving AST engine file paths relative to the current working directory instead of the repo root when evaluating non-staged files, causing false misses for any invocation from a subdirectory. The resolver now consistently anchors against the repo root for both staged and non-staged paths. Fixes #1312.

- b76128e: Refactor `totem handoff` to a deterministic journal scaffold (#1316)

  `totem handoff` previously generated its output via an LLM call, which made the command slow, non-reproducible, and gated on provider availability. It's now a deterministic scaffold: the command reads git state, recent commits, and the active journal directory, then writes a pre-filled template the user (or an agent) can flesh out.

  Closes #1310. Also removes ~500 lines of dead orchestration code that was only used by the old LLM path.

- b76128e: Rename `totem handoff --no-edit` to `--stdout` (#1325)

  **User-visible CLI change.** The `--no-edit` flag on `totem handoff` never worked: Commander.js interpreted it as a boolean negation of a nonexistent `--edit` option, so passing `--no-edit` silently set an unrelated field to `false` and the command still tried to open `$EDITOR`. The flag has been renamed to `--stdout` (with `--lite` kept as an alias) which unambiguously prints the scaffold to stdout.

  Anyone who was passing `--no-edit` was getting the default behavior anyway, so there is no functional regression — just a rename to something that actually works. Fixes #1317. Also deletes the orphaned `handoff-checkpoint` schema files that were stranded when #1316 removed the LLM-path code that referenced them (#1318).

- Updated dependencies [b76128e]
- Updated dependencies [b76128e]
- Updated dependencies [b76128e]
  - @mmnto/totem@1.14.1

## 1.14.0

### Minor Changes

- 11ab03b: 1.14.0 — The Nervous System Foundation

  Cross-repo federated context (shipped as the headline feature) plus opt-in preview of persistent LLM context caching. Mesh and caching are two halves of the same nervous system — sharing context across space (cross-repo federation) and across time (cached tokens) — but they ship at different maturity levels in 1.14.0: mesh is the active default, caching is opt-in preview machinery whose default activation is tracked for 1.15.0 in mmnto/totem#1291.
  - **Cross-Repo Context Mesh (#1295):** New `linkedIndexes: []` option in `totem.config.ts` lets a repo federate semantic search against sibling Totem-managed repos. `SearchResult` now includes source context fields (`sourceRepo`, `absoluteFilePath`) so agents can Read/Edit results unambiguously regardless of which repo the hit came from. Federation merges results via cross-store Reciprocal Rank Fusion (RRF k=60) rather than raw score comparison, eliminating the score-scale bias that would otherwise pin one store's results below another's when their underlying search methods produce scores in incompatible ranges (hybrid RRF ~0.03 vs vector-only ~0.85). A healthy primary + one broken linked store returns partial results with a per-query runtime warning; an entire-federation outage returns `isError: true` instead of masking as "no results found." Per-store reconnect+retry recovers from stale handles during concurrent `totem sync` rebuilds. Targeted `boundary: "<name>"` queries route only to that linked store. Strategy Proposal 215.
  - **LLM Context Caching — Opt-In Preview (#1292):** Anthropic `cache_control` markers wired through the orchestrator middleware for compile + review paths. Sliding TTL configurable via `cacheTTL`, constrained to the two values Anthropic supports natively: `300` (5 minutes, default ephemeral) or `3600` (1 hour, extended cache). The TTL resets on every cache hit, so bulk recompile runs stay warm end-to-end as long as operations land inside the active window. **Defaults to off in 1.14.0** — opt-in via `enableContextCaching: true` in `totem.config.ts` to avoid surprising existing users mid-cycle with a token-usage profile shift. Default activation tracked for 1.15.0 in mmnto/totem#1291. Anthropic-only in this release; Gemini `CachedContent` support tracked for 1.16.0+. Strategy Proposal 217. The full machinery (orchestrator middleware, schema field, TTL-literal validation, per-call cache metric tracking) ships in 1.14.0 — only the default-on behavior is deferred.
  - **Federation diagnostic hardening:** Dimension-mismatch diagnostic now persists across queries (one-shot is wrong when the underlying state is actively blocking — a single warning followed by cryptic LanceDB errors was worse than a persistent actionable message). One-shot first-query flags are only consumed after the gated operation actually succeeds, so transient `getContext` failures don't permanently suppress startup warnings. Linked-store init warnings (empty stores, name collisions, dimension mismatches) survive reconnect cycles intact — they represent static config state that a runtime reconnect can't fix.
  - **Collision-safe state:** Linked store name collisions (two paths deriving to the same basename) are keyed under the bare derived name in `linkedStoreInitErrors` so the `performSearch` boundary lookup can find them — earlier revisions used a descriptive composite key that was unreachable by any user-facing query. Primary store failures are tracked in a dedicated `FailureLog.primary` slot rather than overloading `'primary'` as a map key, which would have collided with legal link names (`deriveLinkName` strips leading dots, so a linked repo at `.primary/` derives to `'primary'`).
  - **Smoke test (#1295 Phase 3):** Standalone CLI integration test (`packages/mcp/dist/smoke-test.js`) exercises a real `ServerContext` against the current `totem.config.ts`, runs a federated query across primary + all linked stores, and emits a pass/fail verdict with per-store hit counts and top-N formatted results. Used as the empirical proof for the PR #1295 body; repurposable for any future cross-repo validation.
  - **19 lessons extracted** from the 1.14.0 PR arc (#1292, #1295, #1296); 1 new compiled rule via local Sonnet (394 total, up from 393). 18 lessons skipped as architectural/conceptual — tracked as `nonCompilable` tuples for doctor triage. Most of the architectural 1.14.0 learnings (silent-drift anti-patterns, reserved-key collisions, session-vs-per-request state confusion, failure-modes-table-as-design-review-tool) are non-compilable by nature but live in `.totem/lessons/` as referenceable architectural patterns. (The initial compile pass produced 2 rules; the delimiter-cache-key rule was reframed as architectural after both bots caught a malformed ast-grep pattern that the LLM produced twice in a row — Tenet 4 says broken rules should not ship, so the lesson now lives as documentation only.)
  - **2722 tests** across core + cli + mcp (up from 2580 at the start of the 1.14.0 cycle).

### Patch Changes

- Updated dependencies [11ab03b]
  - @mmnto/totem@1.14.0

## 1.13.0

### Minor Changes

- 0b08629: 1.13.0 — The Refinement Engine

  Telemetry-driven rule refinement, compilation routing through Claude Sonnet 4.6, and structural pattern upgrades. The compile pipeline now generates high-fidelity rules at scale (393 precise rules, 203 ast-grep / 190 regex), and the doctor diagnostic closes the loop on noisy ones.
  - **Sonnet routing (#1220):** Compile pipeline routes through `anthropic:claude-sonnet-4-6` instead of Gemini. Strategy #73 benchmark across 30 lessons in 4 difficulty tiers proved Sonnet wins on every metric — 90% correctness vs Gemini Pro's 73%, 2.4s vs 19.6s avg. The compiler system prompt was rewritten with explicit ast-grep preference, a syntax cheat sheet, and 6 compound pattern examples mined from benchmark failures.
  - **Bulk Sonnet recompile (#1224):** All 1156 lessons recompiled through Claude Sonnet — 438 → 393 rules, 102 regex→ast-grep upgrades, 143 noisy hallucinated rules purged. Quality > quantity is now enforced by the compile gate, not by manual curation.
  - **Backtick parser hardening (#1225):** Both Pipeline 1 (manual `**Pattern:**` extraction) and Pipeline 2 (LLM JSON output) strip code-fence wrappers from generated patterns so rules can never ship with backtick artifacts.
  - **Context telemetry (#1132, #1227):** `RuleMetric` now tracks the per-context match distribution — `{ code, string, comment, regex, unknown }`. The match context comes from the rule runner's `astContext` field; historical hits are seeded into the `unknown` bucket so legacy metrics remain interpretable.
  - **`totem doctor` upgrade diagnostic (#1131):** New `checkUpgradeCandidates` flags regex rules whose telemetry shows >20% of matches landing in non-code contexts (strings, comments, regex literals). Excludes the `unknown` bucket from the ratio math and requires a 5-event minimum-confidence floor. The legacy `ast` (Tree-sitter) engine is filtered out because its telemetry lands in `unknown` and can't be reasoned about.
  - **`totem compile --upgrade <hash>`:** Re-compile a single targeted rule by hash (full or short prefix). Scoped cache eviction preserves the rule's original `createdAt` metadata; failure paths leave the old rule intact (fail-safe); the `compiled` and `skipped` outcomes are handled consistently. Returns an `UpgradeOutcome { hash, status }` discriminant so callers can distinguish actual replacements from noop / skipped / failed. Rejects `--cloud` (cloud worker still on Gemini, tracked as #1221) and `--force` (the scoped eviction makes both flags redundant and dangerous).
  - **`totem doctor --pr` self-healing upgrade phase:** Slots after the existing downgrade and GC phases. Calls `compileCommand` in-process (no shelling out), only counts `'replaced'` outcomes as actual upgrades, stages `compile-manifest.json` alongside `compiled-rules.json`, and reverts the manifest when nothing changes so the working tree stays clean.
  - **AST empty catch (#664):** 8 empty-catch rules upgraded from the legacy Tree-sitter `#eq?` engine to `ast-grep` structural matching. Correctly handles parameterless catch blocks (ES2019+) and multi-line empty bodies that the predicate-based approach missed.
  - **Pipeline hygiene (#1210, #1211, #1214):** Wind tunnel skips auto-scaffolded TODO fixtures so empty placeholders don't dilute the gate signal. Extract pipeline runs heading-level exact-match deduplication before embedding similarity to short-circuit duplicate ingestion at zero cost. Config-drift test replaced its line-count limit on instructional files with a token-aware character + directive count limit.
  - **Lesson protection rule (governance):** A near-miss almost deleted `.totem/lessons.md` (which sources 41+ functional ast-grep rules) under the assumption it was legacy cruft. Encoded as a Pipeline 1 lint rule with severity `error` that flags the destructive shell command at the point of intent across all script and documentation files. When an agent makes a mistake, the right answer is a deterministic constraint, not a sticky note.
  - **Drift detector — shell prefix filter (core fix):** `extractFileReferences` in `@mmnto/totem` now skips backtick-wrapped strings starting with a recognizable shell command prefix (`rm`, `git rm`, `cp`, `mv`, `cat`, `less`, `head`, `tail`, `tee`, `chmod`, `chown`, `touch`). This is a pre-existing latent bug that surfaced when the lesson protection rule above put `git rm <path>` in its Example Hit / Miss lines — the detector was misparsing the shell command as a literal path and reporting it as orphaned. New unit test in `drift-detector.test.ts` locks in the behavior across all supported shell prefixes.

### Patch Changes

- Updated dependencies [0b08629]
  - @mmnto/totem@1.13.0

## 1.12.0

### Minor Changes

- c4f9746: 1.12.0 — The Umpire & The Router
  - Standalone binary: lite-tier distribution works without Node.js, using @ast-grep/wasm for full AST rule coverage across linux-x64, darwin-arm64, win32-x64
  - Ollama auto-detection: `totem init` detects local Ollama and defaults to gemma4 for classification
  - ast-grep for ESLint properties: `no-restricted-properties` import uses precision AST matching
  - Lazy WASM init: AST engine only initializes when lint/test commands need it
  - GHA injection rule scope: narrowed to `run:` contexts, no false positives in `env:`/`with:` blocks
  - Windows CI stability: fixed flaky orchestrator timeout

### Patch Changes

- Updated dependencies [c4f9746]
  - @mmnto/totem@1.12.0

## 1.11.0

### Minor Changes

- 33039d1: 1.11.0 — The Import Engine

  Rule portability across tools, compiler safety, and thick baseline language packs.
  - **Proactive Language Packs (#1152):** 50 baseline rules (up from 23) across TypeScript, Node.js Security, and Shell/POSIX. Sourced from @typescript-eslint, OWASP, and ShellCheck best practices.
  - **Lesson Retirement Ledger (#1165):** `.totem/retired-lessons.json` tracks intentionally removed rules, preventing re-extraction during future import cycles.
  - **Compiler Guard (#1177):** Rejects self-suppressing patterns (totem-ignore, totem-context, shield-context) at compile time.
  - **ESLint Syntax/Properties (#1140):** `totem import --from-eslint` now handles `no-restricted-properties` (dot, optional chaining, bracket notation) and `no-restricted-syntax` (ForInStatement, WithStatement, DebuggerStatement).
  - **Model Defaults (#1185):** `totem init` defaults updated to `claude-sonnet-4-6` (Anthropic) and `gpt-5.4-mini` (OpenAI).
  - **Supported Models Refresh:** Gemini 2.5 deprecation warning, gemma4/qwen3 for Ollama, new embedding models.

### Patch Changes

- Updated dependencies [33039d1]
  - @mmnto/totem@1.11.0

## 1.10.2

### Patch Changes

- 7b51599: Phase 2: Import Engine foundations
  - Lesson retirement ledger (.totem/retired-lessons.json) prevents re-extraction of intentionally removed rules
  - Compiler guard rejects self-suppressing patterns (totem-ignore/totem-context/shield-context)
  - ESLint adapter: no-restricted-properties (dot, optional chaining, bracket notation) and no-restricted-syntax (ForInStatement, WithStatement, DebuggerStatement) handlers
  - Model defaults updated: claude-sonnet-4-6 (Anthropic), gpt-5.4-mini (OpenAI)
  - Supported models reference refreshed (2026-04-04)

- Updated dependencies [7b51599]
  - @mmnto/totem@1.10.2

## 1.10.1

### Patch Changes

- 8e5ede0: fix: deduplicate exemption sampleMessages and narrow process.exit() rule scope
- 1f01269: fix: refactor monorepo hook templates for strict POSIX sh compliance
- bf80dc1: chore: audit and refine 5 conflicting compiled rules from 1.10.0 batch
  - @mmnto/totem@1.10.1

## 1.10.0

### Minor Changes

- f9623a4: ## 1.10.0 — The Invisible Exoskeleton

  Reduce adoption friction for new users and solo developers.

  ### Features
  - **Pilot mode (#949):** Time-bounded warn-only hooks (14 days / 50 pushes). State tracked in `.totem/pilot-state.json`.
  - **Enforcement tiers (#987):** Strict tier with spec-completed check + shield gate. Agent auto-detection via environment variables.
  - **Solo dev experience (#1039):** `totem extract --local` for local git diffs. Global profile override (`~/.totem/`) with `totem init --global`.

  ### Fixes
  - **.env parser (#1114):** Replaced custom regex with `dotenv` library in CLI and MCP packages.
  - **Spec infrastructure (#1016):** Query expansion for test-related keywords + docstring enrichment.
  - **Manifest rehash (#1155):** Pipeline 5 observation capture now re-hashes compile manifest after mutation.
  - **Pre-push format check (#1156):** `format:check` added to pre-push hook template. Package-manager-agnostic detection.
  - **Exit code fix (#1161):** `--yes` mode now sets `process.exitCode = 1` when all lessons are suspicious.

  ### Internal
  - **Extract refactor (#1159):** Split 1,165-line extract.ts into 5 focused modules with unified assembler.
  - **"Missed Caught" audit (#1153):** Historical bot findings categorized by detection tier (44% deterministic).

### Patch Changes

- @mmnto/totem@1.10.0

## 1.9.0

### Minor Changes

- 1650e51: 1.9.0 — Pipeline Engine milestone release

  Five pipelines for rule creation: P1 manual scaffolding, P2 LLM-generated, P3 example-based compilation, P4 ESLint/Semgrep import, P5 observation auto-capture. Docs, wiki, and playground updated to match.

### Patch Changes

- Updated dependencies [1650e51]
  - @mmnto/totem@1.9.0

## 1.8.5

### Patch Changes

- 9a6a1a0: Add Pipeline 5 observation-based auto-capture from shield findings
- Updated dependencies [9a6a1a0]
  - @mmnto/totem@1.8.5

## 1.8.4

### Patch Changes

- 1bb150d: Add Pipeline 3 example-based compilation prompt for Bad/Good code snippet lessons
- Updated dependencies [1bb150d]
  - @mmnto/totem@1.8.4

## 1.8.3

### Patch Changes

- ea9e7f2: Add `--from-scan` flag to `totem lesson extract` for extracting lessons from fixed code scanning alerts
  - @mmnto/totem@1.8.3

## 1.8.2

### Patch Changes

- 11f4512: Add pre-compiled baseline rules for Python (4), Rust (3), and Go (2) ecosystems
- Updated dependencies [11f4512]
  - @mmnto/totem@1.8.2

## 1.8.1

### Patch Changes

- f088d68: feat: prior art concierge for `totem spec` (#1015)

  Injects shared helper signatures into the spec prompt so agents discover existing utilities (safeExec, readJsonSafe, git helpers, maskSecrets) instead of reimplementing them.

- f088d68: feat: intelligent scope inference for `totem extract` (#1014)

  Analyzes PR changed files and pre-injects a scope suggestion into the extraction prompt so the LLM produces better file glob scopes on extracted lessons.

- Updated dependencies [f088d68]
- Updated dependencies [f088d68]
  - @mmnto/totem@1.8.1

## 1.8.0

### Minor Changes

- 4d87c56: feat: auto-scaffold test fixtures for Pipeline 1 rules (#854) and shield auto-learn (#779)
  - Pipeline 1 error rules now auto-generate test fixture skeletons during compile, preserving error severity instead of downgrading to warning (ADR-065)
  - New `totem rule scaffold <id>` command for manual fixture generation with `--out` option
  - Fixtures seeded from Example Hit/Miss when available, otherwise TODO placeholders
  - New `shieldAutoLearn` config option: when true, shield FAIL verdicts auto-extract lessons without `--learn` flag

### Patch Changes

- Updated dependencies [4d87c56]
  - @mmnto/totem@1.8.0

## 1.7.2

### Patch Changes

- 8fe2329: feat: rule garbage collection and compile progress indicator (#1040, #894)
  - `totem doctor --pr` now archives stale compiled rules (zero triggers after configurable minAgeDays). Opt-in via `garbageCollection` config block. Security-category rules are exempt.
  - `totem compile` now shows elapsed time and ETA with throughput-based estimation. Rate-limited LLM calls (429) are automatically retried with jittered exponential backoff.

- Updated dependencies [8fe2329]
  - @mmnto/totem@1.7.2

## 1.7.1

### Patch Changes

- f2331ce: feat: structured session checkpoints for totem handoff (#914)

  `totem handoff` now emits a Zod-validated JSON checkpoint alongside the Markdown output. Deterministic fields (branch, active_files) come from git; semantic fields (completed, remaining, pending_decisions, context_hints) are parsed from the LLM Markdown. Lite mode gracefully degrades with empty semantic arrays. Checkpoint writes are atomic (tmp+rename).
  - @mmnto/totem@1.7.1

## 1.7.0

### Minor Changes

- c236cac: Developer Experience milestone: redesigned help output with command grouping and [LLM] badges, --json global flag for structured CLI output, totem hooks --force for hook regeneration, triage-pr multi-nit parsing fix, Sensors vs Actuators documentation.

### Patch Changes

- @mmnto/totem@1.7.0

## 1.6.3

### Patch Changes

- 4c5696f: Gate architecture reset (Proposal 207): replaced SHA-based flag files with stateless git hooks (lint + verify-manifest) and content-hash-based PreToolUse review gate. Added SessionStart hook for automatic knowledge context injection. Removed all flag files (.lint-passed, .shield-passed, .spec-completed) and Claude hook enforcement scripts.
  - @mmnto/totem@1.6.3

## 1.6.2

### Patch Changes

- 2a5674f: Push gate simplification (Proposal 206): rewrite pre-push hook as fast read-only checkpoint, add ancestry-aware lint validation with .target-globs cache, diagnostic hook output, and ticket-aware spec gate. totem lint now writes .lint-passed and .target-globs cache files for the hook.
  - @mmnto/totem@1.6.2

## 1.6.1

### Patch Changes

- fix: pipeline fixes, compiler DX improvements, and shield auto-refresh
  - Shield flag auto-refresh on pre-push — no more stale flag after every commit (#1045)
  - Bot source enum in LedgerEvent for accurate exemption tracking (#1048)
  - Thread context propagation for reliable PR comment replies (#1051)
  - Shield false positive fix on synchronous adapter methods (#1058)
  - Compiler transparency — `totem compile --verbose` shows why lessons are skipped (#1060)
  - Zero-match rule detection in lint output (#1061)
  - Compile-time validation for ast-grep patterns (#1062)
  - Hardened hook upgrade tests (#1068)

- Updated dependencies
  - @mmnto/totem@1.6.1

## 1.6.0

### Minor Changes

- 069d652: feat: 1.6.0 — Pipeline Maturity

  Exemption Engine (#917):
  - Dual-storage false positive tracking (local gitignored + shared committed)
  - 3-strike auto-promotion to team-wide suppressions
  - --suppress flag for manual pattern suppression
  - Bot review pushback → exemption tracking via extractPushbackFindings
  - Ledger 'exemption' event type for full audit trail

  Auto-ticket Deferred (#931):
  - createDeferredIssue service with idempotency and thread reply
  - inferNextMilestone for semver-aware milestone assignment
  - PrAdapter: createIssue, replyToComment, addPrComment

  Interactive Triage CLI (#958):
  - totem triage-pr --interactive / -i with Clack prompts
  - Per-finding actions: Fix, Defer, Dismiss, Learn, Skip
  - TTY guard, isCancel on every prompt, confirm preview

  Agent Dispatch (#957):
  - dispatchFix: LLM-powered code fix with atomic commit and thread reply
  - Path traversal guard, git rollback on failure
  - Bot re-trigger: /gemini-review after fixes

  Bot-to-Lesson Loop (#959):
  - "Learn" action saves findings as lessons with bot-review tags
  - Post-triage review-learn prompt for batch extraction

### Patch Changes

- Updated dependencies [069d652]
  - @mmnto/totem@1.6.0

## 1.5.11

### Patch Changes

- 7cd543a: feat: exemption engine, auto-ticket deferred, interactive triage
  - Exemption Engine (#917): dual-storage FP tracking (local + shared), 3-strike auto-promotion, --suppress flag, bot review integration
  - Auto-ticket (#931): createDeferredIssue service with idempotency, milestone inference, thread reply
  - Interactive Triage (#958): Clack prompts for PR triage with fix/defer/dismiss actions
  - Ledger: 'exemption' event type for audit trail
  - Bot review parser: extractPushbackFindings, shared PUSHBACK_PATTERNS constant

- Updated dependencies [7cd543a]
  - @mmnto/totem@1.5.11

## 1.5.10

### Patch Changes

- 990c3bf: Incremental shield, totem status/check, docs staleness fix.
  - feat: incremental shield validation — delta-only re-check for small fixes (#1010)
  - feat: totem status + totem check commands (#951)
  - fix: totem docs staleness — aggressive rewrite of stale roadmap sections (#1024)
  - fix: mermaid lexer error in architecture diagram
  - chore: MCP add_lesson rate limit bumped to 25 per session
  - chore: 364 compiled rules, 966 lessons, 2,000 tests

- Updated dependencies [990c3bf]
  - @mmnto/totem@1.5.10

## 1.5.9

### Patch Changes

- 59a605c: Pipeline integrity fixes, docs storefront rewrite, COSS covenant.
  - fix: MCP spawn ENOENT on Windows — env + shell options (#1023)
  - fix: triage-pr and review-learn surface outside-diff findings (#984)
  - feat: lesson linter semantic heuristics + --strict flag (#1013)
  - docs: README storefront rewrite with flywheel diagram
  - docs: workflow wiki pages (learning loop, self-healing, agent governance)
  - docs: COSS covenant and maintainer policy
  - chore: 354 compiled rules, 953 lessons

- Updated dependencies [59a605c]
  - @mmnto/totem@1.5.9

## 1.5.8

### Patch Changes

- Shield hardening, rule unit testing, and bug bundle
  - Rule unit testing: `**Example Hit:**`/`**Example Miss:**` in lesson markdown verified at compile time
  - Shield context enrichment: full file content for small changed files reduces LLM false positives
  - Shield `--override <reason>`: audited bypass for false positives, logged to trap ledger
  - safeExec: forced pipe mode, type-safe return, removed unsafe `as string` cast
  - gh-utils: error unwrapping matches safeExec error chain structure
  - GH_PROMPT_DISABLED added to all direct gh invocations
  - Hook paths resolved from git root, not cwd
  - Hook regex tightened to match git subcommand only (not filenames)
  - jq for JSON parsing in pre-push hook with grep/sed fallback
  - Agent worktree scratchpads excluded from prettier
  - Compile-after-extract ritual added to CLAUDE.md

- Updated dependencies
  - @mmnto/totem@1.5.8

## 1.5.7

### Patch Changes

- Codebase audit remediation and foundation hardening
  - New `core/src/sys/` standard library: `safeExec()`, `readJsonSafe()`, git adapter (13 functions moved from CLI to core)
  - Error cause chains (ES2022): TotemError hierarchy accepts `cause`, 22 catch blocks updated
  - Forbidden native module rules: 3 compiled rules enforce shared helper usage
  - Phase-gate hooks hardened: `fix/*` exemption removed, warning upgraded to block
  - CoreLogger DI: `setCoreLogger()` replaces `console.warn` in core
  - CRLF fixed: `.gitattributes` forces LF, prettier `endOfLine: "lf"`
  - Shield flag verify-not-consume: push no longer deletes the flag
  - AST query graceful degradation: tree-sitter failures no longer crash compilation
  - Spec gap remediation: `cleanTmpDir` helper, CLI wiring fixes

- Updated dependencies
  - @mmnto/totem@1.5.7

## 1.5.6

### Patch Changes

- fc607ce: ### 1.5.6 — Foundation & Hardening

  **Features:**
  - Unified Findings Model (`TotemFinding`) — common output schema for lint and shield (ADR-071)
  - `totem-context:` is now the primary override directive; `shield-context:` remains as silent alias
  - `totem lint --format json` now includes a `findings[]` array alongside `violations[]`
  - safe-regex validation for user-supplied DLP patterns — ReDoS-vulnerable patterns rejected at input time

  **Fixes:**
  - `matchesGlob()` now correctly handles `*.test.*` and `dir/*.test.*` patterns (was doing literal string match)
  - `readRegistry()` differentiates ENOENT from permission/parse errors via `onWarn` callback
  - `TotemParseError` used for schema validation failures (was generic `Error`)
  - Git hooks path resolved via `git rev-parse --git-path` (supports worktrees and custom `core.hooksPath`)
  - `shield-hints.ts` uses `log.dim()` instead of raw ANSI escape codes
  - `store.count()` failure no longer breaks sync
  - `maxBuffer` (10MB) added to git diff commands — prevents ENOBUFS on large branch diffs
  - Windows `ENOTEMPTY` flake fixed with `maxRetries` in test cleanup

  **Chores:**
  - Dynamic imports in `doctor.ts` for startup latency
  - 8 new lessons extracted from bot reviews (305 compiled rules)
  - Audited and removed 6 `totem-ignore` suppressions
  - Updated compiled baseline hash and scope for JSON.parse rule

- Updated dependencies [fc607ce]
  - @mmnto/totem@1.5.6

## 1.5.5

### Patch Changes

- 19de6b1: feat: categorized triage UX for bot review comments (#956)
  feat: doctor --pr — autonomous rule downgrading (#961)
  feat: auto-format staged files in pre-commit hook
- Updated dependencies [19de6b1]
  - @mmnto/totem@1.5.5

## 1.5.4

### Patch Changes

- 7f5d4e7: feat: user-defined secrets — custom DLP patterns (#921)
  feat: Local Trap Ledger — capture exceptions to NDJSON (#960)
  feat: /review-learn — extract lessons from bot PR reviews (#930)
  fix: SARIF output emits error-severity findings only
  fix: SARIF warning summary as single note annotation
- Updated dependencies [7f5d4e7]
  - @mmnto/totem@1.5.4

## 1.5.3

### Patch Changes

- ### Shield Redesign — Structured Verdicts + Deterministic Fast-Path (#910)
  - Three-stage pipeline: file classification → hybrid diff filtering → Zod-validated JSON findings
  - Non-code diffs (docs, YAML, config) skip LLM entirely for instant PASS
  - Severity levels (CRITICAL/WARN/INFO) with deterministic pass/fail — LLM no longer decides the gate
  - V1 regex fallback for custom `.totem/prompts/shield.md` overrides

  ### Compile Pipeline Reliability (#939, #941)
  - Pre-push hook auto-verifies compile manifest; auto-compiles if stale then aborts push
  - `totem lint` emits non-blocking staleness warning when manifest is out of date
  - Compiler normalizes shallow fileGlobs (`*.ts` → `**/*.ts`) for external tool compatibility
  - `sanitizeFileGlobs` guards against non-string and empty entries

  ### CLI Performance (#943)
  - Converted ~90 static imports to dynamic `await import()` across 25 command files
  - Heavy modules only loaded when the specific command is executed
  - Startup latency reduced for lightweight operations (`--help`, `--version`)

  ### Error Logging (#849)
  - Standardized `[Totem Error]` prefix across all CLI error output
  - `handleError` now consistently tags errors with guard against double-prefixing

- Updated dependencies
  - @mmnto/totem@1.5.3

## 1.5.0

### Minor Changes

- ### 1.5.0 — Open Ecosystem

  **New Commands**
  - `totem list` — discover all Totem workspaces via global registry (`~/.totem/registry.json`)
  - `totem doctor` — run 6 diagnostic checks (config, rules, hooks, embedding, index, secret leaks)

  **Features**
  - Language-agnostic hook installation — hooks resolve `totem` binary at runtime via `command -v`, fall back to package manager `dlx` commands
  - Hook manager helper scripts — `.totem/hooks/*.sh` generated for Husky/Lefthook/simple-git-hooks integration
  - `userFacing` flag on DocTarget for scoped post-processing
  - Smart shield review hints — auto-detects DLP artifacts, test files, new files in diff
  - `// shield-context:` inline annotations for per-file shield guidance
  - `.totem/prompts/shield.md` override with verdict format enforcement

  **SARIF Improvements**
  - Tool name corrected: `totem-shield` → `totem-lint`
  - `helpUri` per rule links to wiki
  - Rich annotation messages with lesson context and rule ID

  **Research**
  - Binary distribution spike: full standalone blocked by LanceDB (144MB native), Lite-tier binary feasible

  **CI/DX**
  - Compile Manifest Attestation skips docs-only PRs via path filter
  - Wiki reorganization: internal docs converted to Totem lessons
  - Shield documentation: new "Working with Shield" wiki page

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.5.0

## 1.4.3

### Patch Changes

- DX hardening, core refactor, and docs overhaul.

  **Core:**
  - Extract `buildCompiledRule()`, `buildManualRule()`, `compileLesson()` to core package — eliminates duplicated rule-building logic between local and cloud compilation paths

  **CLI:**
  - Reduce pre-push hook verbosity: dot reporter by default, full output on failure, `TOTEM_DEBUG=1` for verbose mode
  - Suppress gh CLI stderr leak in multi-repo issue fetch
  - Extract shared `ghExecOptions()` with `GH_PROMPT_DISABLED=1` to prevent interactive auth hangs
  - Protect `<manual_content>` blocks from `stripMarketingTerms` mutation

  **Config:**
  - Remove `**/*.test.ts` from `ignorePatterns` so shield can see test files in diffs

  **Docs:**
  - Rewrite README as technical spec sheet (~130 lines, zero marketing)
  - Create SECURITY.md with full 1.4.x audit
  - Scaffold `docs/wiki/` with enforcement model, MCP setup, cross-repo mesh, troubleshooting
  - Add 6 placeholder wiki pages for 1.5.0 features

- Updated dependencies
  - @mmnto/totem@1.4.3

## 1.4.2

### Patch Changes

- f1509d3: Post-1.4.0 quality sweep (Proposal 189): security fixes, broken functionality, 154 new tests, quality hardening, DRY cleanup, and compile manifest CI attestation
- Updated dependencies [f1509d3]
  - @mmnto/totem@1.4.2

## 1.4.1

### Patch Changes

- ec5b807: Security sweep: fix sanitizer regex statefulness (#871), secret pattern ordering (#872), extract parser injection vector (#873), SQL escaping (#874), and add compile manifest CI attestation (#875)
- Updated dependencies [ec5b807]
  - @mmnto/totem@1.4.1

## 1.4.0

### Minor Changes

#### Security Hardening

### Core (`@mmnto/totem`)

- **AST engines fail-closed** — query/parse errors now throw `TotemParseError` instead of silently returning empty arrays (#848)
- **Compile manifest signing** — `totem compile` writes `.totem/compile-manifest.json` with SHA-256 provenance chain (#842)
- **XML trust boundaries** — new `wrapUntrustedXml()` for network-fetched content, existing `wrapXml()` preserved for trusted local diffs (#843)
- **Tag name validation** — both XML wrappers validate tag names against injection (#843)
- **DLP secret masking** — `maskSecrets()` utility with centralized `rethrowAsParseError` and `getErrorMessage` helpers (#848, #strategy-12)
- **247 compiled rules** (up from 230)

### CLI (`@mmnto/cli`)

- **Wind tunnel SHA lock** — `tools/update-wind-tunnel-sha.sh` with CI verification job (#840)
- **`totem verify-manifest`** — zero-LLM CI command to verify compiled rules match source lessons (#842)
- **Docs confirmation gate** — `totem docs` requires interactive confirmation or `--yes` before writing LLM output (#847)
- **Marketing term stripping** — case-preserving deterministic replacement, preserves code blocks and URLs (#833)
- **DLP middleware** — `maskSecrets` runs before every outbound LLM call, bypasses local providers (#strategy-12)

### MCP (`@mmnto/mcp`)

- **add_lesson auth model** — Zod schema validation, rate limiting (10/session), source provenance, heading sanitization (#844)

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.4.0

## 1.3.19

### Patch Changes

- feat: markdown-magic deterministic doc injection
  - Integrated markdown-magic with 4 transforms (RULE_COUNT, HOOK_LIST, CHMOD_HOOKS, COMMAND_TABLE)
  - Wired docs:inject into totem wrap pipeline (step 5/6, after LLM docs, before compile)
  - 9 unit tests for transforms, runs in 0.02s
  - Eliminates stale hardcoded values in docs across releases

- Updated dependencies
  - @mmnto/totem@1.3.19

## 1.3.18

### Patch Changes

- feat: invisible sync hooks (ADR-066)
  - Post-merge hook only syncs when `.totem/lessons/` files change (git diff-tree conditional)
  - New post-checkout hook syncs on branch switch when `.totem/` differs
  - `totem sync --quiet` flag for silent background hook execution
  - Deterministic end markers for safe eject scrubbing
  - DRY scrubHook helper with try/catch and exact marker matching
  - 230 compiled rules (19 new), 697 lessons

- Updated dependencies
  - @mmnto/totem@1.3.18

## 1.3.17

### Patch Changes

- God Object cleanup: extract.ts (804→566), shield.ts (587→475), audit.ts (560→510), lance-store.ts (523→285). Suspicious lesson detection + semantic dedup moved to core. Nit extraction from CodeRabbit review bodies. Compiler quality gate for untested error rules. Wind tunnel CI gate.
- Updated dependencies
  - @mmnto/totem@1.3.17

## 1.3.16

### Patch Changes

- Universal Baseline grows from 15 → 23 rules (8 Gemini-validated ast-grep patterns). Wind tunnel: 9 test fixtures + ast-grep test runner fix. Adversarial corpus (16 clean-room fixtures). TypeScript detection for monorepo per-package tsconfig.json.
- Updated dependencies
  - @mmnto/totem@1.3.16

## 1.3.15

### Patch Changes

- Rule audit Phase 4: kill bad patterns, scope noisy rules, extract lessons from PR 816. Full audit progression: 2,713 → 555 violations (0 on enforcement path).
- Updated dependencies
  - @mmnto/totem@1.3.15

## 1.3.14

### Patch Changes

- Rule audit: kill 70 garbage rules, dedup 18 overlaps (327 → 239). Docs prompt fix: strip issue refs from user-facing output. README cleanup.
- Updated dependencies
  - @mmnto/totem@1.3.14

## 1.3.13

### Patch Changes

- Spec template tests (#805), spec/compile prompt extraction (#806, #799), compiler utility tests, prompt versioning, post-compact gate strengthening
- Updated dependencies
  - @mmnto/totem@1.3.13

## 1.3.12

### Patch Changes

- Agent workflow doc, spec straitjacket upgrade (militant red flags + Graphviz), lean GEMINI.md, PostCompact agent discipline reminder
- Updated dependencies
  - @mmnto/totem@1.3.12

## 1.3.11

### Patch Changes

- 0b47c94: Security hardening: regex escape, shell:true removal, SQL backtick escape. CodeRabbit integration with path instructions. onWarn logging for AST catch blocks. Unsafe non-null assertions replaced.
- Updated dependencies [0b47c94]
  - @mmnto/totem@1.3.11

## 1.3.10

### Patch Changes

- ceb8663: Context engineering (ADR-063): lean CLAUDE.md router pattern, PostCompact capability manifest, phase-gate enforcement (spec warning before commit). Fixed doc regen hallucination loop.
- Updated dependencies [ceb8663]
  - @mmnto/totem@1.3.10

## 1.3.9

### Patch Changes

- 48cd644: Named index partitions for context isolation. Backfilled body text for 125 Pipeline 1 lessons. Consolidated near-duplicate rules (146 → 144).
- Updated dependencies [48cd644]
  - @mmnto/totem@1.3.9

## 1.3.8

### Patch Changes

- 16e6071: Context isolation boundary parameter for search_knowledge MCP tool. Consolidated near-duplicate rules (146 → 144).
- Updated dependencies [16e6071]
  - @mmnto/totem@1.3.8

## 1.3.7

### Patch Changes

- 6a2eb4c: Lesson linter with pre-compilation gate, spec straitjacket format (TDD forcing + inline invariants), cross-platform CI matrix.
- Updated dependencies [6a2eb4c]
  - @mmnto/totem@1.3.7

## 1.3.6

### Patch Changes

- 09153f8: Pipeline 1 backfill: 127 curated rules now compile deterministically (zero LLM). Added .totem/lessons/ to .prettierignore. Workflow automation hooks and skills for Claude Code.
- Updated dependencies [09153f8]
  - @mmnto/totem@1.3.6

## 1.3.5

### Patch Changes

- 5810bcc: ### Knowledge Quality & Security
  - All 59 universal baseline lessons now include actionable Fix guidance — agents know HOW to resolve violations, not just WHAT is wrong (#642)
  - Path traversal containment check using path.relative prevents reads outside the project directory (#738)
  - Traversal skip now logs a warning via onWarn callback for visibility (#739)

- Updated dependencies [5810bcc]
  - @mmnto/totem@1.3.5

## 1.3.4

### Patch Changes

- 98d56dc: ### Security & Compiler Hardening
  - `totem link` now requires explicit consent ("I understand") before creating cross-trust-boundary bridges. Bypass with `--yes` for CI/CD.
  - Shell orchestrator process termination uses process groups on Unix (prevents zombie processes)
  - SECURITY.md expanded with threat model, audit results, and Totem Mesh risks
  - Gate 1 (Proposal 184): Compiled rules now default to `severity: 'warning'` when LLM omits severity, preventing the #1 compiler regression
  - Added `severity` field to `CompilerOutputSchema`

- Updated dependencies [98d56dc]
  - @mmnto/totem@1.3.4

## 1.3.3

### Patch Changes

- 167737c: ### Launch Polish
  - README: Added "Why Totem" pillars, "Works Without AI" table, and "Totem Mesh" section — all front-and-center
  - Dynamic baseline rule count in post-init message (was hardcoded)
  - Linked store queries now distinguish network vs config errors (#666)
  - Suppressed expected stderr noise in docs.test.ts (#547)
  - console.log → console.error consistency in install-hooks.ts
  - @mmnto/totem@1.3.3

## 1.3.2

### Patch Changes

- 5aeb86d: ### DX Polish
  - Post-init message for Lite users now dares them to test the engine: "Write an empty `catch(e) {}` block and run `npx totem lint`"
  - Hidden legacy commands (`install-hooks`, `demo`, `migrate-lessons`) from `--help` output
  - Clean `totem lint` PASS is now one line instead of six
  - Added launch metrics to README (3-layer gate, 1.75s benchmark)
  - Unix process group cleanup for lint timeout handler (prevents zombie processes)
  - @mmnto/totem@1.3.2

## 1.3.1

### Patch Changes

- ace02c0: ### Bug Fixes
  - **Critical:** Fixed filter ordering in `totem lint` and `totem shield` — ignored patterns (e.g., `.strategy` submodule) were checked after the emptiness test, preventing branch-diff fallback from firing. The Layer 3 pre-push gate was silently passing. (#709)
  - Fixed latent bug where AST rules with empty `pattern` fields could match every line when passed to the regex executor (#710)
  - Replaced 13 raw `throw new Error()` calls with typed `TotemError` subclasses across core and CLI packages (#711)

  ### Improvements
  - **Compiler facade refactor:** Split `compiler.ts` (600 lines) into focused modules — `compiler-schema.ts`, `diff-parser.ts`, `rule-engine.ts` — with `compiler.ts` as a clean coordinator. Public API unchanged. (#710)
  - Added `TOTEM_DEBUG=1` env var for full stack traces during troubleshooting (#711)
  - Added mandatory verify steps (lint + shield + verify_execution) to `totem spec` output (#708)
  - Reverted to curated 147-rule set and added 59 lesson hashes to nonCompilable blocklist (#708)

- Updated dependencies [ace02c0]
  - @mmnto/totem@1.3.1

## 1.3.0

### Minor Changes

- a02f7f8: Release 1.3.0 — MCP verify_execution, spec inline invariants, baseline Fix guidance.

  ### Highlights
  - **MCP `verify_execution` tool**: AI agents can now mathematically verify their work before declaring a task done. Runs `totem lint` as a child process and returns pass/fail with violation details. Supports `staged_only` flag. Warns about unstaged changes.
  - **Spec inline invariant injection**: `totem spec` now outputs granular implementation tasks with Totem lessons injected directly into the steps where they apply. Closes the gap between "planning" and "doing."
  - **Baseline Fix suggestions**: 24 of 59 universal baseline lessons updated with explicit "Fix:" guidance. Every lesson now tells developers what TO do, not just what to avoid.

### Patch Changes

- Updated dependencies [a02f7f8]
  - @mmnto/totem@1.3.0

## 1.2.0

### Minor Changes

- baf6e15: Release 1.2.0 — ast-grep engine, compound rules, and shield CI hardening.

  ### Highlights
  - **ast-grep pattern engine**: Third rule engine alongside regex and Tree-sitter. Patterns look like source code (`process.env.$PROP`, `console.log($ARG)`) — dramatically easier for LLMs to generate accurately.
  - **ast-grep compound rules**: Full support for `has`/`inside`/`follows`/`not`/`all`/`any` operators via NapiConfig rule objects. Enables structural rules like "useEffect without cleanup."
  - **Shield CI hardening**: `shieldIgnorePatterns` now filters the diff before linting, preventing `.strategy` submodule pointer changes from triggering false CI failures.
  - **Dynamic import rules narrowed**: Code scanning alerts for dynamic imports in command files eliminated — rules now only apply to core/adapter code.
  - **Case-insensitive hash matching**: `totem explain` and `totem test --filter` now match regardless of case.
  - **README hardened**: Staff Engineer red team feedback addressed — deterministic enforcement, air-gapped operation, and git-committed artifacts all clarified.
  - **Docs injection scoped**: Manual content injection now targets README only, not all docs.

### Patch Changes

- Updated dependencies [baf6e15]
  - @mmnto/totem@1.2.0

## 1.1.0

### Minor Changes

- 4c0b2cd: Release 1.1.0 — Tier 2 AST engine, cross-totem queries, and totem explain.

  ### Highlights
  - **Tier 2 AST engine**: Compiled rules now support Tree-sitter S-expression queries alongside regex. Enables structural rule matching that regex alone can't express.
  - **Cross-totem queries**: New `linkedIndexes` config lets `totem spec` query knowledge from other totem-managed directories (e.g., strategy repos, design docs) alongside the primary project index.
  - **totem init --bare**: Zero-config initialization for non-code repositories — notes, docs, ADRs, infrastructure configs. No package.json required.
  - **totem explain**: Look up the full lesson behind any compiled rule violation. Supports partial hash prefix matching. Zero LLM, instant.
  - **TODO guardrail rules**: 3 new baseline rules catch `// TODO: implement` stubs, `throw new Error("Not implemented")`, and empty catch blocks. Baseline now ships 15 pre-compiled rules.
  - **Dimension mismatch detection**: `totem sync` writes `index-meta.json`. Switching embedding providers without rebuilding the index now throws a clear error instead of silently returning garbage results.
  - **Compiled rules reverted to curated set**: The 147 hand-audited rules are preserved. Blind recompilation with Flash produced regressions — compiler improvements tracked in #670.

### Patch Changes

- Updated dependencies [4c0b2cd]
  - @mmnto/totem@1.1.0

## 1.0.0

### Major Changes

- d49cdbf: Release 1.0.0 — Totem is production-ready.

  ### Highlights
  - **Zero-config lint protection**: `totem init` now ships 13 pre-compiled universal baseline rules. Every user gets deterministic lint protection from Day 1 — no API keys, no LLM calls required.
  - **Filesystem concurrency locks**: Sync and MCP mutations are now protected by PID-aware file locks with signal cleanup (SIGINT, SIGTERM, SIGHUP, SIGQUIT).
  - **Portability audit**: CLI help grouped by tier, `requireGhCli()` guard on GitHub commands, dynamic orchestrator detection, configurable bot markers, expanded issue URL regex for GitLab/self-hosted.
  - **TotemError consistency**: All error paths use structured `TotemError` hierarchy with recovery hints. Ollama model-not-found errors give actionable `ollama pull` instructions.
  - **MCP race condition fix**: `getContext()` uses promise memoization to prevent duplicate connections from concurrent callers, with retry on transient failures.
  - **Compiled rule audit**: 148 → 147 rules, 0 undefined severity, false positives on TotemError/type imports/stdlib imports eliminated.
  - **Manual docs survive regeneration**: `docs/manual/` content is injected verbatim into `totem docs` output.

### Patch Changes

- Updated dependencies [d49cdbf]
  - @mmnto/totem@1.0.0

## 0.44.0

### Minor Changes

- ab254bf: feat: migrate 54 throw sites to TotemError hierarchy

  Every error now includes a `recoveryHint` telling the user exactly how to fix it. New error classes: `TotemOrchestratorError`, `TotemGitError`. New error code: `GIT_FAILED`. Includes rule fix exempting error class imports from the static import lint rule.

### Patch Changes

- Updated dependencies [ab254bf]
  - @mmnto/totem@0.44.0

## 0.43.0

### Minor Changes

- a19bbca: feat: Universal Baseline — 60 battle-tested lessons ship with `totem init`

  Every new project now gets immediate Day-1 protection against the most common architectural traps, extracted from real PR reviews in Next.js, React, Prisma, Tailwind, and Drizzle. Includes 5 AI-assisted workflow guardrails (scope isolation, Rule of Three, no silent TODO, no monolithic files, no unauthorized refactors). Backward-compatible with existing baseline installations.

### Patch Changes

- @mmnto/totem@0.43.0

## 0.42.0

### Minor Changes

- 557d046: feat: DLP secret masking — strip secrets before embedding (#534)

  Automatically masks API keys, tokens, passwords, and credentials with [REDACTED] before entering LanceDB. Preserves key names in assignments. Handles quoted and unquoted patterns.

  fix: compiler glob patterns — prompt constraints + brace expansion (#602)

  Compiler prompt now forbids unsupported glob syntax. Post-compile sanitizer expands brace patterns. Fixed 12 existing rules.

  fix: init embedding detection — Gemini first (#551)

  Reorders provider detection to prefer Gemini (task-type aware) over OpenAI when both keys present.

  fix: review blitz 2 — dynamic imports, onWarn, rule demotions (#575, #594, #595)

  compile.ts dynamic imports, loadCompiledRules onWarn callback, err.message rule demoted to warning.

  docs: Scope & Limitations section, Solo Dev Litmus Test styleguide rule

### Patch Changes

- Updated dependencies [557d046]
  - @mmnto/totem@0.42.0

## 0.41.0

### Minor Changes

- 028786b: perf: cache non-compilable lessons to skip recompilation (#590)

  `totem compile` now caches lesson hashes that the LLM determined cannot be compiled. Subsequent runs skip them instantly. `totem wrap` goes from ~15 min to ~30 seconds.

  fix: remove duplicate compiled rule causing false positives (#589)

  Root cause was duplicate rules from compile, not a glob matching bug. Removed the broad duplicate.

  feat: auto-ingest cursor rules during totem init (#596)

  `totem init` scans for .cursorrules, .mdc, and .windsurfrules. If found, prompts user to compile them into deterministic invariants.

  fix: strip known-not-shipped issue refs from docs generation (#598)

  Ends the #515 hallucination that recurred in 5 consecutive releases. Pre-processing strips from git log, post-processing strips from LLM output.

### Patch Changes

- Updated dependencies [028786b]
  - @mmnto/totem@0.41.0

## 0.40.0

### Minor Changes

- 99f8995: feat: .mdc / .cursorrules ingestion adapter (#555)

  New `totem compile --from-cursor` flag. Scans .cursor/rules/\*.mdc, .cursorrules, and .windsurfrules files. Parses frontmatter and plain text rules. Compiles them into deterministic Totem rules via the existing LLM pipeline.

  docs: README Holy Grail positioning (ADR-049)

  "A zero-config CLI that compiles your .cursorrules into deterministic CI guardrails. Stop repeating yourself to your AI." MCP as step 2, Solo Dev Superpower section, command table with speed metrics.

### Patch Changes

- Updated dependencies [99f8995]
  - @mmnto/totem@0.40.0

## 0.39.0

### Minor Changes

- dda8715: feat: shield severity levels — error vs warning (#498)

  Rules now support `severity: 'error' | 'warning'`. Errors block CI, warnings inform but pass. SARIF output maps severity to the `level` field. JSON output includes error/warning counts.

  chore: rule invariant audit — 137 rules categorized (#556)

  27 security (error), 56 architecture (error), 47 style (warning), 7 performance (warning). 39% reduction in hard blocks while maintaining all guidance.

  fix: auto-healing DB — dimension mismatch + version recovery (#500, #548)

  LanceStore.connect() auto-heals on embedder dimension mismatch and LanceDB version/corruption errors. Nukes .lancedb/ and reconnects empty for a clean rebuild.

### Patch Changes

- Updated dependencies [dda8715]
  - @mmnto/totem@0.39.0

## 0.38.0

### Minor Changes

- 89fcb02: feat: Trap Ledger Phase 1 — SARIF extension + enhanced totem stats

  Every `totem lint` violation now generates SARIF properties with eventId, ruleCategory, timestamp, and lessonHash. Rules support a `category` field (security/architecture/style/performance). `totem stats` shows "Total violations prevented" with category breakdown and top 10 prevented violations.

  fix: code review blitz — 7 findings from Claude+Gemini synthesis

  Critical: MCP loadEnv quote stripping, add_lesson race condition (promise memoization), SARIF format flag works with totem lint. High: extracted shared runCompiledRules (-75 lines), Gemini default model fixed, health check --rebuild → --full, lesson validation before disk write.

  fix: stale prompts — docs glossary, init model, reflex block v3

  Command glossary in docs system prompt prevents LLM confusing lint/shield. Gemini embedder model corrected in init. AI_PROMPT_BLOCK distinguishes lint (pre-push) from shield (pre-PR).

  chore: 137 compiled rules (39 new), 17 extracted lessons, docs sync

### Patch Changes

- Updated dependencies [89fcb02]
  - @mmnto/totem@0.38.0

## 0.37.0

### Minor Changes

- 382c77a: feat: `totem lint` — new command for fast compiled rule checks (zero LLM)

  Split from `totem shield`. `totem lint` runs compiled rules against your diff in ~2 seconds with no API keys needed. `totem shield` is now exclusively the AI-powered code review. `--deterministic` flag is deprecated with a warning.

  feat: semantic rule observability (Phase 1)

  Rules now track `createdAt`, `triggerCount`, `suppressCount`, and `lastTriggeredAt` metadata. `totem stats` displays rule metrics. Foundation for automated rule decay analysis.

  fix: shield rule scoping — dynamic import and match/exec rules narrowed

  Dynamic import rule scoped to command files only (not adapters/orchestrators). match/exec rule scoped to security-sensitive code only. `.cjs` rule excludes CI workflow YAML.

### Patch Changes

- Updated dependencies [382c77a]
  - @mmnto/totem@0.37.0

## 0.36.0

### Minor Changes

- 74e521e: feat: graceful degradation for orchestrator and embedder providers

  Orchestrators (Gemini, Anthropic) now fall back to their CLI equivalents when the SDK or API key is missing. Embedders fall back to Ollama when the configured provider is unavailable. LazyEmbedder uses promise memoization to prevent race conditions with concurrent embed() calls.

  feat: configurable issue sources — support multiple repos in triage/extract/spec

  Add `repositories` field to `totem.config.ts`. When set, triage, audit, and spec commands aggregate issues from all listed repos. Supports `owner/repo#123` syntax for disambiguation.

  chore: switch default embedder to Gemini (gemini-embedding-2-preview)

  Task-type aware 768d embeddings replace OpenAI text-embedding-3-small (1536d). Requires `totem sync --full` after upgrade.

### Patch Changes

- Updated dependencies [74e521e]
  - @mmnto/totem@0.36.0

## 0.35.1

### Patch Changes

- 9cd061e: Bug blitz: four fixes from triage priorities.
  - **#396:** Anthropic orchestrator uses model-aware max_tokens (Haiku 4K, Sonnet 8K, Opus 16K)
  - **#397:** matchesGlob now supports single-star directory patterns (e.g., `src/*.ts`)
  - **#398:** extractChangedFiles handles quoted paths with spaces
  - **#399:** AST gate reads staged content (`git show :path`) before falling back to disk

- Updated dependencies [9cd061e]
  - @mmnto/totem@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [f6074c4]
  - @mmnto/totem@0.35.0

## 0.34.0

### Minor Changes

- 7ae97f9: Add Copilot and Junie to totem init agent detection.
  - **Init:** Auto-detect JetBrains Junie (`.junie/`) and GitHub Copilot (`.github/copilot-instructions.md`)
  - **Init:** Correct Junie MCP path to `.junie/mcp/mcp.json` (was incorrectly using `.mcp.json`)
  - **Init:** Copilot gets reflex injection only (no MCP — Copilot doesn't support it)

### Patch Changes

- @mmnto/totem@0.34.0

## 0.33.1

### Patch Changes

- 7a90a44: Bug fixes: Gemini embedder dimension mismatch detection, shell orchestrator process leak on Windows.
  - **MCP:** Detect embedding dimension mismatch on first query and return clear error message with fix instructions (rebuild index + restart MCP server)
  - **CLI:** Fix shell orchestrator process leak on Windows — use `taskkill /T` to kill entire process tree on timeout instead of just the shell wrapper
  - **CLI:** `totem demo` command for previewing spinner animations
  - @mmnto/totem@0.33.1

## 0.33.0

### Minor Changes

- a91ca10: Agent hooks, rule testing harness, multi-domain MCP, and docs migration.
  - **CLI:** `totem test` command — TDD harness for compiled shield rules with pass/fail fixtures
  - **CLI:** Agent hooks reinstated — Claude PreToolUse shield gate, Gemini SessionStart + BeforeTool
  - **CLI:** Instruction file length enforcement (FR-C01, <50 lines)
  - **Core:** `parseFixture()`, `testRule()`, `runRuleTests()` — rule testing engine
  - **Core:** Export `matchesGlob` for shield file filtering
  - **MCP:** `--cwd` flag for multi-domain knowledge architecture (strategy Totem)
  - **MCP:** Robust `--cwd` validation with `[Totem Error]` prefix
  - **Shield:** `shieldIgnorePatterns` config field (separate from sync ignorePatterns)
  - **Shield:** Compiled rules respect ignorePatterns from config
  - **Shield:** execSync rule scoped to exclude hook scripts
  - **Shield:** Literal-file-path rule scoped to lesson files only (#457)
  - **Docs:** README-to-wiki migration — marketing-lean README + 5 new wiki pages
  - **Config:** Consumer hook templates use `--deterministic` shield

### Patch Changes

- Updated dependencies [a91ca10]
  - @mmnto/totem@0.33.0

## 0.32.0

### Minor Changes

- bd40894: Agent config cleanup, shield ignorePatterns separation, and Junie support.
  - **Shield:** `shieldIgnorePatterns` config field separates shield exclusions from sync indexing
  - **Shield:** Deterministic shield now respects `ignorePatterns` from config
  - **Core:** Export `matchesGlob` for shield file filtering
  - **Init:** Fix Gemini CLI reflexFile path (`.gemini/gemini.md` → `GEMINI.md`)
  - **Init:** Export `AI_PROMPT_BLOCK` for drift test consumption
  - **MCP:** Replace empty catch blocks with `logSearch()` disk-based diagnostics
  - **Config:** Add `shieldIgnorePatterns` to config schema
  - **Junie:** Lean guidelines.md, correct MCP path (`.junie/mcp/mcp.json`), compiled rules as skill
  - **Drift Tests:** 41-assertion config drift test suite guarding hooks, agent configs, MCP scaffolding, and secrets

### Patch Changes

- Updated dependencies [bd40894]
  - @mmnto/totem@0.32.0

## 0.31.0

### Minor Changes

- feat: hybrid search (FTS + vector with RRF reranking), Gemini embedding provider, retrieval eval script
- feat: lessons directory migration — dual-read/single-write (per-file lessons replace monolithic lessons file)

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @mmnto/totem@0.31.0

## 0.30.0

### Minor Changes

- d0be9c6: Add compile --export as Step 5 of totem wrap, exclude export targets from deterministic shield, throw NoLessonsError in compile command

### Patch Changes

- Updated dependencies [d0be9c6]
  - @mmnto/totem@0.30.0

## 0.29.0

### Minor Changes

- e311aff: Lesson injection into all orchestrator commands, totem audit, and Junie docs.
  - **`totem audit`** — strategic backlog audit with human approval gate, interactive multi-select, shell injection prevention via `--body-file`, resilient batch execution (#362)
  - **Lesson injection** — vector DB lessons now injected into shield (full bodies), triage (condensed), and briefing (condensed) via shared `partitionLessons()` + `formatLessonSection()` helpers (#370)
  - **Junie docs** — MCP config example and export target docs in README (#371)
  - **Lesson ContentType** — `add_lesson` MCP tool now uses `lesson` content type for better vector DB filtering (#377)
  - **Versioned reflex upgrade** — `REFLEX_VERSION=2` with `detectReflexStatus()` and `upgradeReflexes()` for existing consumers (#375)
  - **Spec lesson injection** — lessons injected as hard constraints into `totem spec` output (#366)

### Patch Changes

- Updated dependencies [e311aff]
  - @mmnto/totem@0.29.0

## 0.28.0

### Minor Changes

- d221d54: Extraction Hardening: semantic dedup for `totem extract`, dangling-tail heading cleanup, submodule-aware file resolver, and CLI `--help` fix.

### Patch Changes

- Updated dependencies [d221d54]
  - @mmnto/totem@0.28.0

## 0.27.0

### Minor Changes

- 20c912d: feat: saga validator for `totem docs` — deterministic post-update validation catches LLM hallucinations (checkbox mutations, sentinel corruption, frontmatter deletion, excessive content loss) before writing to disk (#356)

  fix: scope deterministic shield rules with fileGlobs — 21 of 24 compiled rules now have package-level glob scoping, preventing MCP-specific rules from firing against the entire codebase. Also fixes `matchesGlob` to support directory-prefixed patterns like `packages/cli/**/*.ts` (#357)

### Patch Changes

- Updated dependencies [20c912d]
  - @mmnto/totem@0.27.0

## 0.26.1

### Patch Changes

- 8c7cda9: Add formatting rules to totem docs system prompt to prevent monster single-line phase summaries
- c67495e: Fix false positives in suspicious lesson detection for security-related lessons
  - @mmnto/totem@0.26.1

## 0.26.0

### Minor Changes

- ac9f37e: Add `totem hooks` command for non-interactive hook installation with `--check` validation. Dogfood enforcement hooks in this repo: pre-commit blocks main/master, pre-push runs deterministic shield. Hooks auto-install on `pnpm install` via prepare script.

### Patch Changes

- 16849b4: fix: `totem hooks` now walks up to git root in monorepo sub-packages
  - @mmnto/totem@0.26.0

## 0.25.0

### Minor Changes

- 0455d24: Adversarial ingestion scrubbing, eval harness, Bun support, and model audit
  - **Adversarial ingestion scrubbing:** `sanitizeForIngestion()` strips BiDi overrides (Trojan Source defense) from all content types and invisible Unicode from prose chunks. Suspicious patterns flagged via `onWarn` but never stripped. Detection regexes consolidated into core for DRY reuse. XML tag regex hardened against whitespace bypass.
  - **Adversarial evaluation harness:** Integration tests with planted architectural violations for model drift detection. Deterministic tests run without API keys; LLM tests gated behind `CI_INTEGRATION=true` for nightly runs against Gemini, Anthropic, and OpenAI.
  - **Bun support:** `detectTotemPrefix()` checks for both `bun.lockb` (legacy) and `bun.lock` (Bun >= 1.2). Priority: pnpm > yarn > bun > npx.
  - **Model audit:** Updated default orchestrator model IDs — Anthropic to `claude-sonnet-4-6`, OpenAI to `gpt-5.4`/`gpt-5-mini`.
  - **Supported models doc:** New `docs/supported-models.md` with provider model listing APIs and discovery scripts.

### Patch Changes

- Updated dependencies [0455d24]
  - @mmnto/totem@0.25.0

## 0.24.0

### Minor Changes

- 3b8e53b: feat: git hook enforcement — block main commits + deterministic shield gate

  `totem init` now installs two enforcement hooks alongside the existing post-merge hook:
  - **pre-commit**: blocks direct commits to `main`/`master` (override with `git commit --no-verify`)
  - **pre-push**: runs `totem shield --deterministic` before push, bails instantly if no compiled rules exist (zero Node startup penalty for Lite tiers)

  Both hooks are idempotent, chain-friendly (append to existing hooks without clobbering), and cross-platform. Non-shell hooks (Node/Python) are detected and safely skipped.

  Also fixes truncated lesson headings — `generateLessonHeading` no longer appends ellipsis on truncation, and the extract prompt uses positive structural constraints for better LLM compliance.

### Patch Changes

- Updated dependencies [3b8e53b]
  - @mmnto/totem@0.24.0

## 0.23.0

### Minor Changes

- 83923f0: Add native Ollama orchestrator provider with dynamic `num_ctx` support
  - New `provider: 'ollama'` orchestrator config hits Ollama's native `/api/chat` endpoint directly via fetch (no SDK required)
  - Supports `numCtx` option to dynamically control context length and VRAM usage per-command
  - VRAM-friendly error messages on 500 errors suggest lowering `numCtx`
  - Connection errors suggest running `ollama serve`
  - Mirrors the existing `ollama-embedder` pattern (plain fetch, baseUrl defaulting)

- 53eda11: feat: `shield --learn` extracts lessons from failed verdicts (#303) and reduces false positives in suspicious lesson detection (#302)

  **Shield --learn:** When a Shield LLM verdict fails, passing `--learn` runs a second extraction pass to distill systemic architectural lessons from the review. Supports `--yes` for unattended CI use (suspicious lessons are auto-dropped). Lessons are appended to `.totem/lessons.md` and immediately re-indexed.

  **False positive reduction:** The instructional leakage heuristic now requires an attack verb (ignore, disregard, reveal, etc.) in proximity to a sensitive target (system prompt, previous instructions, etc.), preventing false positives on educational lessons that merely discuss security patterns.

- 5418aae: Add suspicious lesson detection to `totem extract` with `--yes` mode blocking
  - New `flagSuspiciousLessons()` heuristic validator detects prompt injection indicators: instructional leakage, XML tag leakage, Base64 payloads, excessive unicode escapes, and overly long headings
  - Interactive UI marks suspicious lessons with `[!]` prefix and deselects them by default
  - `--yes` mode automatically blocks suspicious lessons with warnings and exits non-zero for CI pipelines
  - Dry-run mode surfaces suspicious flags in preview output

### Patch Changes

- Updated dependencies [83923f0]
  - @mmnto/totem@0.23.0

## 0.22.0

### Minor Changes

- b3a07b8: ### 0.22.0 — AST Gating, OpenAI Orchestrator, Security Hardening

  **New Features**
  - **Tree-sitter AST gating** for deterministic shield — reduces false positives by classifying diff additions as code vs. non-code (#287)
  - **Generic OpenAI-compatible orchestrator** — supports OpenAI API, Ollama, LM Studio, and any OpenAI-compatible local server via BYOSD pattern (#285, #293)
  - **`totem handoff --lite`** — zero-LLM session snapshots with ANSI-sanitized git output (#281, #288)
  - **CI drift gate** with adversarial evaluation harness (#280)
  - **Concise lesson headings** — shorter, more searchable headings from extract (#271, #278)

  **Security Hardening**
  - Extract prompt injection hardening with explicit SECURITY NOTICE for untrusted PR fields (#279, #289, #295)
  - Path containment checks in drift detection to prevent directory traversal (#284)
  - ANSI terminal injection sanitization in handoff and git metadata (#292)

  **Bug Fixes**
  - GCA on-demand review configuration fixes (#278, #282)
  - GitHub Copilot lesson export confirmed working via existing `config.exports` (#294)

### Patch Changes

- Updated dependencies [b3a07b8]
  - @mmnto/totem@0.22.0

## 0.21.0

### Minor Changes

- e252d41: ### New Features
  - **`totem shield --mode=structural`** — Context-blind code review that catches syntax-level bugs (asymmetric validation, copy-paste drift, brittle tests, off-by-one errors) without Totem knowledge retrieval (#270)
  - **`totem compile --export`** — Cross-model lesson export via sentinel-based injection into AI assistant config files (#269)

  ### Improvements
  - Provider conformance suite with 15 tests and nightly smoke tests (#263)
  - CLA automation via `contributor-assistant/github-action` (#266)
  - Dependabot configured for security-only npm scanning and GitHub Actions version pinning (#272)
  - GitHub Actions updated: `actions/checkout` v4→v6, `actions/setup-node` v4→v6 (#273, #274)
  - Project docs and lessons synced via `totem wrap` (#275)

### Patch Changes

- Updated dependencies [e252d41]
  - @mmnto/totem@0.21.0

## 0.20.0

### Minor Changes

- fff1f27: Individual document targeting for `totem docs`, centralized `resolveOrchestrator()` with model name security validation, fix for truncated lesson extraction headings, cross-provider routing support, docs pipeline stability fixes, and relicense to Apache 2.0.

### Patch Changes

- Updated dependencies [fff1f27]
  - @mmnto/totem@0.20.0

## 0.19.0

### Minor Changes

- feat: native API orchestrators for Gemini and Anthropic SDKs
  - Add `gemini` and `anthropic` orchestrator providers for direct SDK calls (BYOSD)
  - Extract shared orchestrator interface with discriminated union config
  - Add `isQuotaError` shared utility and `detectPackageManager` for BYOSD prompts
  - Add `fileGlobs` scoping for compiled shield rules
  - Add XML sentinel validation for `totem docs` responses

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.19.0

## 0.18.0

### Minor Changes

- feat: async orchestrator and ReDoS protection
  - Refactored shell orchestrator from `execSync` to async `spawn` with streaming stdout/stderr, 50MB safety cap, and proper timeout handling (#206)
  - Added compile-time ReDoS static analysis via `safe-regex2` — vulnerable regex patterns are rejected during `totem compile` with diagnostic reasons (#218)
  - Graceful per-doc error handling in `totem docs` — a single doc failure no longer aborts the entire batch

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.18.0

## 0.17.0

### Minor Changes

- 03372b4: feat: drift detection for self-cleaning memory (#181)

  Adds `totem sync --prune` to detect and interactively remove lessons with stale file references. The drift detector scans `.totem/lessons.md` for backtick-wrapped file paths that no longer exist in the project, then presents an interactive multi-select for pruning. After pruning, the vector index is automatically re-synced.

  New core exports: `parseLessonsFile`, `extractFileReferences`, `detectDrift`, `rewriteLessonsFile`.

### Patch Changes

- Updated dependencies [03372b4]
  - @mmnto/totem@0.17.0

## 0.16.1

### Patch Changes

- c3a76cc: Fix `totem docs` aborting on large responses by adding maxBuffer (10MB) to execSync, matching the existing GitHub CLI adapter pattern. Adds descriptive error messages for buffer overflow and timeout failures.
  - @mmnto/totem@0.16.1

## 0.16.0

### Minor Changes

- 76b4cf4: Minimum viable configuration tiers (Lite/Standard/Full). Embedding is now optional — Lite tier works with zero API keys. Auto-detects OPENAI_API_KEY during `totem init`.

### Patch Changes

- Updated dependencies [76b4cf4]
  - @mmnto/totem@0.16.0

## 0.15.0

### Minor Changes

- Universal baseline lessons during `totem init` (#128), orphaned temp file cleanup on CLI startup (#108), and automated doc sync via `totem docs` command (#190) integrated into `totem wrap` as Step 4/4.

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.15.0

## 0.14.0

### Minor Changes

- 171a810: Minimum viable configuration tiers (Lite/Standard/Full). Embedding is now optional — Lite tier works with zero API keys. Auto-detects OPENAI_API_KEY during `totem init`.

### Patch Changes

- Updated dependencies [171a810]
  - @mmnto/totem@0.14.0

## 0.13.0

### Minor Changes

- c177a1b: - **Shield GitHub Action (#180):** Added `action.yml` composite action for CI/CD enforcement — runs `totem sync` + `totem shield` as a pass/fail quality gate on PRs
  - **Rename CLI commands (#185):** `learn` → `extract`, removed `anchor` alias (use `add-lesson`), updated all docs and tests
  - **Interactive multi-select (#168):** `totem extract` now presents a `@clack/prompts` multi-select menu for cherry-picking lessons instead of all-or-nothing Y/n
  - **CI test step:** Added `pnpm test` to the CI workflow (was missing)

### Patch Changes

- @mmnto/totem@0.13.0

## 0.12.0

### Minor Changes

- 075680f: Add `totem bridge`, `totem eject`, and `totem wrap` commands
  - **`totem bridge`** — Lightweight, no-LLM context bridge for mid-session compaction. Captures git branch, modified files, and optional breadcrumb message.
  - **`totem eject`** — Clean reversal of `totem init`: scrubs git hooks, AI reflex blocks, Claude/Gemini hook files, and deletes Totem artifacts. Confirmation prompt with `--force` bypass.
  - **`totem wrap <pr-numbers...>`** — Post-merge workflow automation: chains `learn → sync → triage` with interactive TTY for lesson confirmation.

### Patch Changes

- @mmnto/totem@0.12.0

## 0.11.0

### Minor Changes

- Await sync in `add_lesson` with timeout for definitive success/failure confirmation
- Configurable `contextWarningThreshold` with system warnings on large payloads
- Condensed context for fast-boot commands (`briefing`, `triage`)
- Context Management Guardrail injected via `totem init` reflex templates

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [e97f5cd]
  - @mmnto/totem@0.10.0

## 0.9.2

### Patch Changes

- 373f872: fix: sync reliability and unified XML escaping
  - Persistent sync state tracking via .totem/cache/sync-state.json — no more missed changes (#155)
  - Deleted files are now purged from LanceDB during incremental sync (#156)
  - Unified wrapXml utility in @mmnto/core with consistent backslash escaping (#158)

- Updated dependencies [373f872]
  - @mmnto/totem@0.9.2

## 0.9.1

### Patch Changes

- fb8a72a: fix: harden host integration — XML safety, hook format, config validation, script extraction
  - XML-delimit MCP tool responses to mitigate indirect prompt injection (#149)
  - Fix Claude hook format: use {type, command} objects instead of bare strings (#153)
  - Replace manual type guards with Zod schema validation for settings.local.json (#148)
  - Extract inline shell hooks into dedicated Node.js scripts (.totem/hooks/) (#147)
  - @mmnto/totem@0.9.1

## 0.9.0

### Minor Changes

- cd7fe05: feat: seamless host integration — Gemini CLI & Claude Code hooks
  - hookInstaller infrastructure in `totem init` with idempotent scaffoldFile/scaffoldClaudeHooks utilities
  - Gemini CLI: SessionStart briefing hook, BeforeTool shield gate, Totem Architect skill
  - Claude Code: PreToolUse hook for shield-gating git push/commit
  - Cloud bot prompt refinement in AI_PROMPT_BLOCK for GCA integration
  - Enhanced `search_knowledge` tool description

### Patch Changes

- @mmnto/totem@0.9.0

## 0.8.0

### Minor Changes

- 9ec7ffd: ### CLI UX Polish
  - **Branded CLI output** — All commands now display colored, tagged output via `picocolors` (cyan brand, green success, yellow warnings, red errors, dim metadata)
  - **Ora spinners** — `totem sync` shows a TTY-aware spinner that gracefully falls back to static lines in CI/piped environments
  - **ASCII banner** — `totem init` displays a branded Totem banner on startup
  - **Colored Shield verdict** — `totem shield` now shows PASS in green and FAIL in red

  ### Custom Prompt Overrides
  - **`.totem/prompts/<command>.md`** — Override the built-in system prompt for any orchestrator command (spec, shield, triage, briefing, handoff, learn) by placing a markdown file in your project
  - **Path traversal protection** — Command names are validated against a strict regex pattern

  ### Multi-Argument Commands
  - **`totem spec <inputs...>`** — Pass multiple issue numbers, URLs, or topics in a single invocation (max 5, deduplicated)
  - **`totem learn <pr-numbers...>`** — Extract lessons from multiple PRs in one command with a single confirmation gate

### Patch Changes

- Updated dependencies [9ec7ffd]
  - @mmnto/totem@0.8.0

## 0.7.0

### Minor Changes

- Unify gh-utils and PrAdapter, comprehensive test audit, bug fixes
  - Extracted shared `gh-utils` with `ghFetchAndParse` and `handleGhError`
  - Added `PrAdapter` abstraction for PR data fetching
  - Added unit tests for all adapters, orchestrator, and CLI commands
  - Fixed maxBuffer overflow on paginated GitHub API responses
  - Added GitHub API rate limit detection
  - Simplified ZodError messages for better UX

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.7.0

## 0.6.0

### Minor Changes

- Shield: add security checklist (prompt injection, input sanitization, env injection) and enforce retrieved Totem lessons as strict review gate

### Patch Changes

- @mmnto/totem@0.6.0

## 0.5.0

### Minor Changes

- a91d8ac: Auto-scaffold MCP server configs during `totem init` for detected AI tools (Claude Code, Gemini CLI, Cursor)

### Patch Changes

- bf9ffaa: Fix MCP config scaffolding on Windows by wrapping `npx` with `cmd /c` (bare `npx` fails as a spawned command on win32)
  - @mmnto/totem@0.5.0

## 0.4.0

### Minor Changes

- Add evidence-based quality gate to `totem shield` — LLM now emits a structured PASS/FAIL verdict that gates CI and pre-push hooks with a non-zero exit code on failure.

### Patch Changes

- @mmnto/totem@0.4.0

## 0.3.0

### Minor Changes

- 80aaf73: feat: add `totem anchor` (and `totem add-lesson`) command to interactively add lessons to project memory and trigger a background re-index

### Patch Changes

- @mmnto/totem@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.2.2

## 0.2.1

### Patch Changes

- Harden orchestrator prompts with stronger personas (Red Team Reality Checker, Staff Architect, strict PM) and upgrade spec/shield/triage model overrides to gemini-3.1-pro-preview.
- Updated dependencies
  - @mmnto/totem@0.2.1

## 0.2.0

### Minor Changes

- 87a465a: Initial release — Phases 1-3 complete.
  - Core: LanceDB vector store, 5 syntactic chunkers (TS AST, markdown, session log, schema, test), OpenAI + Ollama embedding providers, full ingest pipeline with incremental sync
  - CLI: `totem init`, `totem sync`, `totem search`, `totem stats`
  - MCP: `search_knowledge` and `add_lesson` tools over stdio

### Patch Changes

- Updated dependencies [87a465a]
  - @mmnto/totem@0.2.0
