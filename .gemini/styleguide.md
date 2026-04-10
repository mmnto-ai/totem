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
- **DO NOT USE:** `spin`, `anchor`, `kick`, `dream`. Those terms belong only in the philosophy section of the README.

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

- **Lesson heading truncation.** Do not suggest expanding lesson headings beyond 60 characters. The `HEADING_MAX_CHARS` limit is enforced by `lesson-format.ts`. Headings serve as SARIF identifiers and vector search labels, not prose. Truncation is by design.
- **Redundant "Lesson:" prefix in lesson headings.** Do not flag `## Lesson — Lesson: ...` as a style issue on auto-generated lesson files. This is a known `sanitizeHeading` improvement tracked separately.
- **Timestamps appearing as "future dates."** The project is actively developed in 2026. Do not flag `compiledAt` or `createdAt` timestamps as errors or bugs.
- **Confusing `totem lint` and `totem review`.** `totem lint` = compiled rules, zero LLM, fast, Lite tier. `totem review` = AI-powered code review, Full tier. Never describe review as "deterministic" or lint as "AI-powered." The old `totem shield` command is a deprecated alias for `totem review` — do not use the old name in suggestions. Issue #515 (Claude Code hooks) was closed and NOT shipped — do not reference it as a live feature.
- **Alphabetical sorting of command lists.** Do not suggest alphabetically sorting command lists in documentation tables. Commands are grouped by function (init → hooks → enforcement → workflow), which is more useful than alphabetical order.

## 7. Tone & Voice (The Solo Dev Litmus Test)

Every feature, doc, and CLI output must pass this test: **Can a developer working on a side project at 2 AM install this, run it, and feel like they got a superpower in under 60 seconds?**

- Use hacker language, not corporate language. "Stop repeating yourself to your AI" — not "Synergistic Governance Framework."
- Enterprise features (SARIF, federated memory, RBAC) are always opt-in. The default path is zero-config.
- CLI output should feel like instant gratification, not a compliance report.
- If a sentence sounds like it belongs in a SOC 2 audit deck, rewrite it so it sounds like a README.

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

## 10. Hash Conventions (Do Not Flag as Mismatches)

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
- Formula: `sha256(`${heading}\n${body}`).slice(0, 16)`
- 16 characters
- Hashes ONLY `heading + '\n' + body` — explicitly excludes frontmatter
- Used as the canonical content hash for the compile manifest, rule loader,
  doctor diagnostic, and `totem compile --upgrade <hash>` CLI flag

### Why they're independent

1. The two hashes are computed over different input strings (full file vs
   heading+body only). They cannot agree even by coincidence — one includes
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
that will be discussed in a strategy proposal under `.strategy/proposals/`,
not as a code review finding.
