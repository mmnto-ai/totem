# Gemini Styleguide for Totem (@mmnto/totem)

This document defines the architectural patterns, styling, and coding conventions for the `totem` repository. The Gemini Code Assist bot will use this to enforce rules during PR reviews.

## 0. Product Philosophy (Review with this headspace)

Totem is a **deterministic governance platform** — a standard library for codebase governance, not an opinionated workflow tool. Every review must be evaluated against these tenets:

- **Sensors, Not Actuators (Tenet 13):** Totem provides sensors (lint, rules, knowledge). Users wire their own actuators (hooks, CI). Do not suggest opinionated workflow changes or prescribe how users should integrate Totem into their CI.
- **Math for Mechanics:** The deterministic engine (regex + AST) is the core product. Do not suggest replacing deterministic checks with statistical/LLM approaches. `totem lint` must remain zero-LLM.
- **Platform of Primitives (Tenet 12):** Totem is building blocks, not a framework. Do not suggest abstractions that couple independent primitives together.
- **Local-First:** The standalone binary and Ollama integration prove governance works 100% offline. Do not suggest cloud dependencies for core enforcement paths.

When a review finding conflicts with these tenets, the tenet wins.

## 1. Architectural Boundaries

- **Vector DB Abstraction:** All LanceDB interactions must remain strictly within the `@mmnto/totem` (core) package. The CLI and MCP packages must never import LanceDB directly.
- **MCP Stdio Restriction:** The `@mmnto/mcp` package must use the `@modelcontextprotocol/sdk` and communicate exclusively via stdio.
  - **CRITICAL:** Do NOT use `console.log` or `console.error` anywhere in the `@mmnto/mcp` package for debugging, as this will corrupt the stdio transport protocol. Use the MCP server's built-in logging mechanisms or write to a dedicated log file if necessary.

## 2. Naming Conventions (Vanilla Strategy)

We intentionally avoid metaphor-heavy names in the shipped code to ensure immediate developer comprehension.

- **DO USE:** `search_knowledge`, `add_lesson`, `totem init`, `totem sync`.
- **AVOID as identifiers — judged in context:** `spin`, `anchor`, `kick`, `dream`. The list is unchanged and load-bearing: these are the **tells to look for**, not a string-ban. This is an **identifier** rule (the DO-USE list is entirely identifiers). Flag one when it is doing **metaphor work in a name**; allow it when it is the **precise, load-bearing technical term** — `repo-anchored` is legitimate terminology, not a violation. A blanket string-match here is a Tenet-9 miscompile (a Green gate standing in for a Yellow judgment), and its false positives force per-repo workarounds around real terms — the `repo-anchored` → `git-native` churn on mmnto-ai/totem#2132 is the falsifier. As _product vocabulary_ these terms belong on the README/wiki philosophy surfaces, and they appear freely in **prose** — including **code comments** — where they are sentences, not names (see the § 6 prose carve-out). Canonical ruleset: [`voice-tuning-dataset.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/voice-tuning-dataset.md) (mmnto-ai/totem-strategy#938).

## 3. TypeScript Rules

- **Strict Typing:** Avoid `any`. Use generics and strict interfaces for metadata injection.
- **Error Handling:** Use `try/catch` and throw clear, descriptive errors with the `[Totem Error]` prefix so the user understands exactly what went wrong.
  - _Example:_ `throw new Error('[Totem Error] No embedding provider configured. Set OPENAI_API_KEY in .env');`
- **File Extensions:** Use `.ts` for all files. No `.tsx` since this is a Node.js library without a UI.

## 4. Ingest Pipeline & Chunking

- When implementing syntactic chunking (e.g., AST parsing), chunks must always prepend a context header.
  - _Example Format:_ `File: <path> | Context: The '<name>' function

[Raw Code Chunk Here]`

- When parsing Markdown, heading hierarchy must be preserved in the chunks.
  - _Example Format:_ `[Heading 1 > Heading 2 > Heading 3] <content>`

## 5. Configuration Strategy

- Do not hardcode project-specific rules into the core engine.
- All dynamic settings (glob patterns, embedding providers, chunking strategies) must be read from the user's `totem.config.ts` file located at the root of the consuming project.

## 6. Do Not Suggest (Declined Patterns)

**GCA DECLINE PROTOCOL (MANDATORY):** If you are declining a user's code pattern or providing structural review feedback, you MUST use the `add_lesson` tool with the `review-guidance` tag to codify the rule into the project's memory. Do NOT just leave a comment on the PR. Adding the lesson ensures the governance engine learns from the interaction. When adding a lesson for a declined pattern, you must also update this section of the styleguide to prevent future drift.

The following suggestions have been repeatedly declined during code review. Do not raise them again.

- **Zod for small parsers.** Do not suggest replacing manual validation with Zod schemas for simple LLM response parsing or small data structures (< 10 fields). Zod is used at system boundaries (config, API input), not for internal data transformers.
- **Configurable constants.** Do not suggest making hardcoded limits configurable (e.g., max search results, issue limits, context caps) unless the user explicitly needs runtime configurability. Named constants are sufficient.
- **`Promise.all` on tiny loops.** Do not suggest parallelizing loops that iterate over < 10 items with trivial operations. The overhead of `Promise.all` outweighs any benefit.
- **Async exec for sequential shell calls.** Do not suggest converting `execFileSync` to async `execFile` in CLI commands that run sequentially by design (e.g., batch GitHub mutations that must execute in order).
- **Import shared types across packages.** Types like `ContentType` already propagate from `@mmnto/totem` (core) to CLI and MCP via the dependency graph. Do not suggest creating shared type packages or re-exporting types.
- **Dynamic config loading for hardcoded paths.** Do not suggest making internal file paths (e.g., `.totem/lessons.md`, `.totem/compiled-rules.json`) configurable. These are structural constants of the Totem protocol.
- **"Unused exports" on test-consumed constants.** Do not flag exported constants, prompt strings, or named limits (e.g., `SPEC_SEARCH_POOL`, `MAX_LESSONS`, `SHIELD_LEARN_SYSTEM_PROMPT`, `assemblePrompt`) as unused. These are deliberately exported so that co-located test files can import and assert against them. This is a standard testing pattern in the project.
- **Static top-level imports from `@mmnto/totem` in CLI command files.** CLI command files use dynamic `await import('@mmnto/totem')` inside function bodies, not static top-level imports. This is enforced by a compiled shield rule. The core package pulls in LanceDB and other heavy dependencies — top-level imports slow CLI startup for every command, including `--help`.
  - **EXCEPTION: `import type` statements are free.** TypeScript `import type { ... } from '@mmnto/totem'` is erased at compile time and has zero runtime cost. Do NOT flag type-only imports as violations of the dynamic import rule.
- **`process.cwd()` in CLI command handlers.** CLI commands resolve paths relative to the user's working directory via `process.cwd()`. This is correct behavior — do not suggest resolving relative to config file location. The config resolution layer (`resolveConfigPath`) already handles config-relative paths.
- **Dynamic imports in `index.ts` command registration.** The CLI entry point (`packages/cli/src/index.ts`) should use `await import()` inside `.action()` handlers to lazy-load command implementations. Dynamic imports in `.action()` handlers are the target pattern — do not flag them as violations.
- **Empty catch blocks in core library pure functions.** Core library functions (`packages/core/src/`) sometimes use empty catch blocks when: (a) the function is pure with no logger dependency, (b) validation happens at the schema level, and (c) the catch guards against edge cases only. Do not flag these as violations — the design intent is silent fallback, not logging.

- **`.catch()` rewrites to escape `lesson-fail-open-catch-ban`.** Do not suggest rewriting a blanket fail-soft `catch (err) { … }` as `.catch(() => …)` to get past the Tenet-4 catch-ban rule — a `call_expression` the rule never matches is matcher-evasion, strictly worse for the corpus. The sanctioned form for a Tenet-4 shape-2 fail-soft (a declared IO/LLM/network boundary whose whole surface is operational) is the honest `catch_clause` annotated `// totem-context: fail-soft backstop=<name>`, naming the loud systemic backstop that throws on whole-boundary failure (the ADR-111 fold-C `assertPipelineProductive` shape, `attempted>0 && succeeded===0 ⟹ throw`). The lint recognizes this attestation and emits a **non-blocking WARN** when `backstop=` is missing — it establishes token-presence only; the backstop's loudness + per-item accounting are verified at review/ADR level, not by the lint (Tenet 13/19; `design-tenets.md` Tenet 4; mmnto-ai/totem#2214, strategy#702/#708). Shape 1 (type-discriminated rethrow, `if (!(err instanceof <ExpectedError>)) throw err; return <soft-default>`) is the rule working — it already carries a `throw_statement`, so do not flag it.
- **§ 2 naming terms in prose (docs or code comments).** The metaphor-heavy-name rule (`spin`, `anchor`, `kick`, `dream`) governs IDENTIFIERS in shipped code, and is judged in context rather than string-matched (§ 2) — § 2's DO-USE list is entirely identifiers. Do not extend it to **prose anywhere** — internal records (`.totem/specs/**`, dispatches, journals) **or code comments** (`// anchor the cursor` is a sentence, not a name). (Declined on mmnto-ai/totem#2162; re-fired 5× HIGH on code-comment prose on mmnto-ai/totem#2246 — this clause closes that recurrence so GCA stops re-flagging comment prose each round.)

- **Lesson heading truncation.** Do not suggest expanding lesson headings beyond 60 characters. The `HEADING_MAX_CHARS` limit is enforced by `lesson-format.ts`. Headings serve as SARIF identifiers and vector search labels, not prose. Truncation is by design.
- **Redundant "Lesson:" prefix in lesson headings.** Do not flag `## Lesson — Lesson: ...` as a style issue on auto-generated lesson files. This is a known `sanitizeHeading` improvement tracked separately.
- **Timestamps appearing as "future dates."** The project is actively developed in 2026. Do not flag `compiledAt` or `createdAt` timestamps as errors or bugs.
- **Confusing `totem lint` and `totem review`.** `totem lint` = compiled rules, zero LLM, fast, Lite tier. `totem review` = AI-powered code review, Full tier. Never describe review as "deterministic" or lint as "AI-powered." The old `totem shield` command is a deprecated alias for `totem review` — do not use the old name in suggestions. Issue #515 (Claude Code hooks) was closed and NOT shipped — do not reference it as a live feature.
- **Suggesting `totem compile` over `totem lesson compile` in docs.** Do not suggest replacing `totem lesson compile` with the shorter `totem compile` form in user-facing documentation. `totem compile` is **explicitly marked "Deprecated alias for `totem lesson compile`"** in the CLI's own help output (`pnpm exec totem compile --help`); `totem lesson compile` is the canonical entity-grouped command name. The README and some older docs use the shorter form for brevity, but the canonical-command direction the project is moving in is the entity-grouped form (the `Entities:` section of `totem --help` lists `rule`, `lesson`, `exemption`, `config` as the canonical groupings). New docs should use `totem lesson compile`; existing references to `totem compile` are tech debt that gets resolved via doc sweeps, not by suggesting the deprecated alias as canonical.
- **Alphabetical sorting of command lists.** Do not suggest alphabetically sorting command lists in documentation tables. Commands are grouped by function (init → hooks → enforcement → workflow), which is more useful than alphabetical order.
- **`TotemConfigError` → `TotemError` substitution in CLI code.** Do not suggest replacing `new TotemConfigError(...)` with `new TotemError(...)` in `packages/cli/`. `TotemConfigError` is the canonical class for CLI-layer flag-conflict validation and config-invalid conditions (e.g., `--refresh-manifest` + `--force`, `--upgrade` + `upgradeBatch`, missing orchestrator config). It is used in 10+ CLI files (7× in `packages/cli/src/commands/compile.ts` alone, including the canonical precedent at `compile.ts:486`). There is no "reserved for `packages/core` layer" rule; the class is a semantic subtype of `TotemError` carrying `CONFIG_MISSING | CONFIG_INVALID` codes, not a layer-scoped class. Long-term taxonomy refinement across the 23-code `TotemErrorCode` enum is tracked in mmnto-ai/totem#1630; any migration will happen as a coordinated sweep, not via per-PR blanket substitution.
- **`log.error` + `process.exitCode` vs `throw` in CLI entrypoint guard clauses.** Do not suggest replacing `log.error('Totem Error', '...'); process.exitCode = 1; return;` with `throw new TotemError(...)` in CLI command entrypoints for missing-file, not-found, or ambiguous-prefix classes. The canonical reference is `rulePromoteCommand` at `packages/cli/src/commands/rule.ts:300-394` (and its sibling `lessonArchiveCommand` at `packages/cli/src/commands/lesson.ts`). CLI entrypoints print clean errors and exit non-zero; library-layer code throws. Both styles coexist in the project by design.
- **Strict SemVer on `package.json` version bumps.** Do not suggest that a `patch` bump (e.g., `1.15.1` → `1.15.2`) carrying new CLI commands, new flags, or new core primitives should be a `minor` bump per strict SemVer. This project uses **milestone-driven versioning**: `minor` bumps reserve for milestone-theme deliveries (e.g., 1.15.0 Pack Distribution, 1.16.0 Ingestion Pipeline headline); `patch` bumps ship incremental features that land between milestones. Precedent: 1.14.1 through 1.14.17 shipped 17 patch releases carrying substantial features including the shell-orchestrator RCE fix (`#1429`), the compile-hardening trio (`#1580 / #1589 / #1581`), and the first compound ast-grep rules (`#1455`).

- **Sigstore-gate enforcement on `@mmnto/pack-*` `private:true` → `private:false` flips.** Do not flag flipping a Totem pack from `private: true` to `private: false` as violating a "security-sensitive packages must remain private until cryptographic signing infrastructure exists" rule. No such rule is in this styleguide. The Sigstore + in-toto verification gate is tracked in `mmnto-ai/totem#1492` and is open / tier-2 / pre-implementation. Alpha-pilot publishes during ADR-097 § Stage 1 (e.g., `@mmnto/pack-rust-architecture` enabling external-consumer onboarding such as `liquid-city`) are explicitly exempted from the gate because the gate isn't built yet. When `#1492` ships, both `@mmnto/pack-*` packages re-flow through the gate as part of normal pack-publish discipline. The exemption is canonical and recorded in the gating ticket (`mmnto-ai/totem#1779`).

- **`workspace:*` references in published-package `package.json`.** Do not flag `workspace:*` dependency references in a public package's `package.json` as producing an "invalid registry package" or as requiring resolution via a changeset before publish. The pnpm + changesets publish pipeline transforms `workspace:*` to the resolved fixed-group version automatically at `pnpm publish` time. Empirical proof on the live registry: `@mmnto/cli@1.23.0` source has `"@mmnto/totem": "workspace:*"` in `dependencies`, and `npm view @mmnto/cli@1.23.0 dependencies` returns `'@mmnto/totem': '1.23.0'`. The same transform applies to every fixed-group cohort member. Additionally, references in `devDependencies` are not installed by registry consumers regardless of the source spec. This is a publish-time mechanic, not a publish-blocker.

- **Session-start hook stderr diagnostics — `[Totem Error]` prefix and `throw` over `process.stderr.write` in degradation-path catch blocks.** Do not suggest changing `process.stderr.write('[<hook-name>] ...')` to `[Totem Error]` prefix, or `process.stderr.write(...)` to `throw new Error(...)`, in session-start hook catch blocks (e.g., `.claude/hooks/session-context.mjs`). Two reasons:
  1. **Script-identifier prefix is the canonical hook-helper pattern.** Production hook-helper code at `packages/cli/src/hooks/auto-context.ts:149, :160, :175, :189` uses `[auto-context]` for stderr.write diagnostics; only thrown errors (line 168) carry `[Totem Error]`. The pattern: `[<hook-name>]` for degradation/diagnostic stderr writes, `[Totem Error]` for explicitly-constructed thrown errors. Section 3's `[Totem Error]` guidance governs **thrown errors**, not raw stderr diagnostics in degradation paths.
  2. **Resilient continuation, not fail-fast.** Session-start hooks are explicitly designed to never crash session boot — every Claude/Gemini hook in this repo terminates with an outer catch that logs and `process.exit(0)`s. Throwing inner catch errors short-circuits subsequent context-building (e.g., a proposals read failure would skip vector-context entirely). §9 line 112's "Defense-in-depth guards… use `log.warn()` + counter increments, NOT `throw`. The design intent is resilient continuation, not fail-fast" governs the same principle even when the diagnostic medium is raw `process.stderr.write` rather than `log.warn()`.

- **Wrapping engine-boot helpers (`loadInstalledPacks`, `bootstrapEngine`) in `try/catch` and rethrowing as `TotemError`.** Do not suggest wrapping calls to `loadInstalledPacks()` (or the CLI `bootstrapEngine` helper that delegates to it) in a try/catch that rethrows as `new TotemError('BOOTSTRAP_FAILED', ...)`. ADR-097 § 5 Q5 mandates synchronous fail-loud at engine boot, and `loadInstalledPacks` already throws structured errors that name the offending pack, the manifest path, and the underlying cause via `Error.cause` (see `packages/core/src/pack-discovery.ts` failure paths: malformed JSON, schema validation, missing pack file, pack `require()` throw, peer-dep mismatch, callback throw, callback returning a Promise). Wrapping these in a generic `BOOTSTRAP_FAILED` would erase the pack-name + cause chain that makes the failure actionable for the user. The fail-loud-at-boundary policy is **`bootstrapEngine` inheriting `loadInstalledPacks`'s already-structured errors verbatim** — the user sees `"Pack 'foo' registration callback threw … cause: <original>"` right after `loadConfig`, which is the correct mental context ("did I install this right?"). Section 3's general "use `TotemError`" guidance applies to CLI-layer flag-conflict validation and config-invalid surfaces; engine-boot helpers that delegate to a function which already produces structured errors are exempt.

- **Inventing return-object fields by name-similarity to manifest or write-side surfaces.** Do not suggest adding fields to a function's return object (e.g., `ruleCount: 0`) on the grounds that "the manifest tracks `rule_count`" or "the `LintResult` interface expects it." Verify the actual TypeScript interface bytes before recommending a field addition. Two distinct surfaces with similar names are not contracts that need to be reconciled inside the runtime result type — `compile-manifest.json`'s `rule_count` is a write-side telemetry field, distinct from `RunCompiledRulesResult` which carries `violations | findings | rules | output | regexTimeouts` and exposes the count via `rules.length`. If a field is genuinely required by the interface, `tsc` will reject the omission at compile time; the test suite passing on the diff is empirical proof the type is satisfied. Hallucinated-field findings of this shape have been seen on `packages/cli/src/commands/run-compiled-rules.ts` (mmnto-ai/totem#1832 R1 GCA decline).

## 7. Tone & Voice (The Solo Dev Litmus Test)

Every feature, doc, and CLI output must pass this test: **Can a developer working on a side project at 2 AM install this, run it, and feel like they got a superpower in under 60 seconds?**

- Use hacker language, not corporate language. "Stop repeating yourself to your AI" — not "Synergistic Governance Framework."
- Enterprise features (SARIF, federated memory, RBAC) are always opt-in. The default path is zero-config.
- CLI output should feel like instant gratification, not a compliance report.
- If a sentence sounds like it belongs in a SOC 2 audit deck, rewrite it so it sounds like a README.

### Strictness follows the surface

Mirrors the canonical [`voice-tuning-dataset.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/voice-tuning-dataset.md) (mmnto-ai/totem-strategy#938). Every constraint above names an AI **tell** — a pattern that reads as machine-generated. Apply them as **judgment, not string-matching**: flag a tell when it is doing **filler work**, allow it when it is the **precise, load-bearing choice** in context.

- **Public / marketing copy** — `README.md`, `wiki/**`, release and landing copy. The worse error is sounding AI-generated: read the tells **strictly** and accept the occasional false positive.
- **Technical surfaces** — `AGENTS.md`, published ADRs and doctrine, CLI help text. The worse error is **imprecise terminology and per-repo workarounds**: precision wins, and a tell is flagged **only when it is genuinely vague filler**.
- **Internal working artifacts** — `.totem/specs/**`, dispatches, journals, and code comments. **Exempt.** Do not raise voice findings on them at all (see also the § 6 prose carve-out).

A blanket string-ban across all surfaces is a Tenet-9 miscompile — a Green gate standing in for a Yellow judgment.

## 8. Override Directives (ADR-071)

Totem supports inline override directives that suppress rules or provide context to the AI reviewer:

- `// totem-ignore` — suppresses all compiled lint rules on this line (hard suppress, no justification)
- `// totem-ignore-next-line` — suppresses all rules on the following line
- `// totem-context: <reason>` — semantic override (ADR-071). Suppresses lint rules AND provides justification to shield. This is the preferred mechanism over `totem-ignore` because it records the "why."
- `// shield-context: <reason>` — deprecated alias for `totem-context:`. Still works but emits a console warning as of 1.6.0. Will be removed in 2.0.0.

**IMPORTANT:** Every `totem-ignore` MUST be accompanied by a follow-up ticket to address the underlying issue. Using `totem-ignore` without a ticket is a project rule violation. `totem-context:` is preferred because it records the justification inline.

All overrides are recorded in the Trap Ledger (`.totem/ledger/events.ndjson`) for telemetry.

## 9. Error Handling & Logging Conventions

- `log.error()` calls MUST use `'Totem Error'` as the tag — this is styleguide rule 21. Do not suggest changing it to the command-specific `TAG` constant.
- `log.info()`, `log.success()`, `log.warn()`, `log.dim()` use the command-specific `TAG` constant (e.g., `'Audit'`, `'Shield'`, `'Triage'`).
- Defense-in-depth guards in batch processing loops should use `log.warn()` + counter increments, NOT `throw`. The design intent is resilient continuation, not fail-fast. Only suggest `throw` for guards that should halt the entire operation.
- Library code (`@mmnto/totem` core) uses `onWarn` callbacks, never direct `console.warn`.
- **Error cause chains (ES2022):** When re-throwing errors in `catch` blocks, always pass the original error as the `cause` property: `throw new TotemError('...', '...', err)`. NEVER concatenate `err.message` into a new error string — this destroys the original stack trace. The `handleError` debug logger traverses `.cause` chains automatically.

## 10. PR Review Reply Protocol

Centralized per ADR-105 in `mmnto-ai/totem-strategy`. See [`doctrine/bot-protocols.md` § 8.1](https://github.com/mmnto-ai/totem-strategy/blob/main/doctrine/bot-protocols.md) for the canonical consolidated round-comment SOP. The Bot-Protocol Gate § in `CLAUDE.md` is the load-bearing pointer at the agent-context layer.

## 11. Hash Conventions (Do Not Flag as Mismatches)

Totem uses **two independent hash functions** for lessons, computed over different
inputs. They are NOT supposed to match — this is the established convention since
the project shipped, not drift.

### Filename hash (`lesson-XXXXXXXX.md`)

- Defined in `packages/core/src/lesson-io.ts:14-17`
- Formula: `sha256(full_file_content).substring(0, 8)`
- 8 characters
- Hashes the **full file content** including frontmatter (`**Tags:**`, `**Scope:**`)

### `lessonHash` (in `compiled-rules.json` and the compile manifest)

- Defined in `packages/core/src/compiler.ts:60-66`
- Formula: `sha256(heading + '\n' + body).slice(0, 16)`
- 16 characters
- Hashes ONLY `heading + '\n' + body` — explicitly excludes frontmatter
- Used as the canonical content hash for the compile manifest, rule loader,
  doctor diagnostic, and `totem compile --upgrade <hash>` CLI flag

### Why they're independent

1. The two hashes are computed over different input strings (full file vs
   heading+body only). They are not expected to match because one includes
   frontmatter content the other excludes.
2. The slice lengths differ (8 vs 16 chars). Even if both were SHA-256 of
   identical inputs, the 8-char filename hash would only match the FIRST 8
   chars of the 16-char `lessonHash`, and the inputs are not identical.
3. ALL existing 393+ compiled rules from 1.13.0 and earlier exhibit this
   convention. Verifiable by sampling: pick any rule, look at its `lessonHash`,
   then look at the corresponding `.totem/lessons/lesson-*.md` file's
   filename — they will not match. They were never designed to match.

### Do not flag

When reviewing PRs that touch `.totem/compiled-rules.json` or
`.totem/lessons/lesson-*.md`, do not flag mismatches between the 16-char
`lessonHash` field and the 8-char filename hash. They are independent
identifiers by design. If a future change unifies them under a single scheme,
that will be discussed in a strategy proposal under
`<strategyRoot>/proposals/` (resolved by `resolveStrategyRoot`, typically a
sibling `../totem-strategy/` clone), not as a code review finding.

### Curated lessons are exempt from hash-named filenames

The `lesson-XXXXXXXX.md` hash-name pattern documented above applies to
**extracted lessons** produced by `totem extract` (the auto-derivation pipeline
that turns PR-review feedback into lesson files). It is NOT a universal
mandate for all files under `.totem/lessons/`.

**Curated lessons** — manually authored lesson files committed by maintainers,
typically Yellow / non-compilable architectural or convention guidance — use
**descriptive kebab-case filenames** (`lesson-<descriptive-name>.md` or
`<descriptive-name>.md`). This is the established convention since the project
shipped, with 14+ examples in tree as of `mmnto-ai/totem#1836`:

- `lesson-error-cause-chain.md`, `lesson-fail-open-catch-ban.md`
- `lesson-forbid-child-process.md`, `lesson-forbid-inline-json-parse.md`
- `lesson-forbid-raw-git-exec.md`, `lesson-knowledge-quality-chain.md`
- `lesson-protect-lessons-md.md`, `lesson-spawn-shell-true-ban.md`
- `lesson-security-audit.md`, `lesson-exported-mutable-let-ban.md`
- `lesson-docs-regen-hallucination.md`, `lesson-agent-orientation.md`
- `dev-environment-setup.md`, `testing-conventions.md`,
  `maintainer-release-process.md`

The export pipeline (`exportLessons` in `compile.ts`) operates on the in-file
heading + body, NOT on the filename — so descriptive-named curated lessons
flow through the pipeline identically to hash-named extracted lessons. Both
coexist in `.totem/lessons/` without collision.

**Do not flag** descriptive-named lesson filenames as styleguide violations.
The `lesson-XXXXXXXX.md` hash convention is a property of the extract
pipeline's output, not a constraint on the directory.
