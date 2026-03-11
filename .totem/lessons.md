# Totem Lessons

Lessons learned from PR reviews and Shield checks.
This file is version-controlled and reviewed in PR diffs.

---

## Lesson — 2026-02-28T22:42:43.291Z

**Tags:** embedding, ollama, openai, dogfood

When OpenAI embedding API returns 429, fall back to Ollama with nomic-embed-text for local development. The chunking pipeline is provider-agnostic — only the embedding step changes.

## Lesson — 2026-03-02T09:18:21.039Z

**Tags:** lancedb, schema, trap, dogfood

When the LanceDB schema defined in `@mmnto/totem` changes (e.g., renaming a column from `filepath` to `filePath`), running `totem sync` against an existing `.lancedb/` directory will crash with a Rust schema error from `lance-datafusion`. Because the index is treated as a disposable build artifact rather than a migratable database, the solution is to explicitly delete the `.lancedb/` folder (`rm -rf .lancedb`) and re-run the sync.

## Lesson — 2026-03-02T09:18:21.052Z

**Tags:** cli, windows, shell, trap

When executing external shell commands (like invoking the Gemini CLI orchestrator) on Windows, passing large prompts directly via string concatenation will fail with an 'argument list too long' error. You must write the prompt to a temporary file and pass the filepath. Crucially, the filepath placeholder in the shell command must be wrapped in quotes (e.g., `"{file}"`) to prevent crashes when the user's root directory contains spaces (e.g., `C:\Users\John Doe\`).

## Lesson — 2026-03-02T09:18:21.092Z

**Tags:** mcp, security, trap, gemini

When generating temporary files for an AI agent to read (such as orchestrator prompts), do NOT use the global OS temp directory (`os.tmpdir()`). Secure MCP clients (like the Gemini CLI) run with strict workspace boundary restrictions and will throw a 'Path not in workspace' error if asked to read a file outside the project root. Always write temporary agent files inside the project directory (e.g., `.totem/temp/`).

## Lesson — 2026-03-03T01:51:33.783Z

**Tags:** gemini-cli, orchestrator, telemetry, json-output

Gemini CLI `-o json` flag returns structured output with `response` (content) and `stats.models.<model>.tokens` (input, candidates, cached, thoughts, tool) plus `stats.models.<model>.api` (totalRequests, totalLatencyMs). Use try-parse on stdout rather than string-matching the command for `-o json` — handles edge cases and doesn't require config awareness.

## Lesson — 2026-03-03T01:52:00.000Z

**Tags:** gemini-cli, quota, tokens, overhead

Gemini CLI injects ~8,000+ tokens of its own system prompt overhead even with `-e none`. A trivial 5-word input costs 8,254 input tokens. This "base tax" means telemetry token counts will always look inflated relative to our actual prompt content. Important context when evaluating cost — don't panic at high input token counts.

## Lesson — 2026-03-03T01:52:10.000Z

**Tags:** gemini-cli, quota, rate-limiting, caching

Gemini free-tier quota is rate-limited by requests per rolling 24h window, NOT by tokens. A 5KB prompt and a 55KB prompt cost the same — one call. Caching (reducing call count) is the highest-leverage optimization, not prompt size reduction.

## Lesson — 2026-03-03T01:52:20.000Z

**Tags:** shield, git, branch-diff, fallback

`totem shield` must fall back to branch diff (`main...HEAD`) when no uncommitted changes exist, otherwise it's useless after committing. Use `getDefaultBranch()` to dynamically detect the base branch via `git symbolic-ref refs/remotes/origin/HEAD` with main/master probe fallback. Throw (don't silently return 'main') if detection fails entirely.

## Lesson — 2026-03-03T02:16:24.772Z

**Tags:** spawn, stdio, writestream, trap, windows, mcp

When spawning a background child process with output redirected to a log file, use `fs.openSync(path, 'a')` to get a synchronous file descriptor instead of `fs.createWriteStream()`. The WriteStream's `fd` is `null` until the async 'open' event fires, which causes `spawn()` to reject the stdio argument. Close the FD in the parent after spawning — Node duplicates it for the child.

## Lesson — 2026-03-03T03:20:15.922Z

**Tags:** git, cli, error-handling

Distinguish between a missing binary (`ENOENT`) and a command execution failure when wrapping CLI tools to prevent silent, incorrect fallbacks. Swallowing all errors can lead to generic defaults being used when the environment itself is misconfigured, delaying the diagnosis of a missing dependency.

## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** typescript, telemetry, trap

Use nullish coalescing (`??`) instead of logical OR (`||`) when defaulting numeric metrics like latency or token counts, as `||` incorrectly triggers the fallback for valid `0` values (e.g., cached responses). This prevents inaccurate telemetry where a real zero-value is replaced by a wall-clock fallback.

## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** telemetry, metrics, data-parsing

Return `null` instead of `0` when an external API fails to provide a metric to avoid ambiguity with valid zero-value measurements. This allows downstream logic to accurately detect missing data and decide when to employ alternative calculation methods like wall-clock time.

## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** git, cli, validation

Throw an explicit error if a required environmental configuration (like a repository's default branch) cannot be detected, rather than returning a hardcoded fallback. Hardcoded fallbacks like 'main' cause confusing downstream failures if the assumption is incorrect for the user's specific environment.

## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** telemetry, zod, maintenance

Isolate `JSON.parse` in its own try/catch block when processing external CLI output to differentiate between malformed JSON and logic errors in subsequent schema validation. This improves error precision by separating raw parsing failures from structure mismatches.

## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** cli, design-decision

For rough diagnostic summaries or progress indicators, `string.length` is often sufficient for size approximations in primarily English/ASCII contexts. Avoiding byte-precision calculations for non-critical displays reduces code complexity when the difference is negligible for the use case.

## Lesson — 2026-03-05T03:12:04.126Z

**Tags:** architecture, adapter-pattern, issue-tracker, pivot

The IssueAdapter interface lives at `packages/cli/src/adapters/issue-adapter.ts` with `StandardIssue` and `StandardIssueListItem` types. The GitHub implementation is `GitHubCliAdapter` at `packages/cli/src/adapters/github-cli.ts`. PR-related functionality is similarly abstracted via `PrAdapter` at `packages/cli/src/adapters/pr-adapter.ts`. Future issue tracker adapters (Jira, Linear) should implement the same interface.

## Lesson — 2026-03-05T03:16:17.884Z

**Tags:** workflow, shield, pre-push, trap

ALWAYS run `totem shield` before pushing or creating a PR. This is a core Workflow Orchestrator Ritual defined in CLAUDE.md. Don't skip it even when momentum is high — that's exactly when mistakes slip through.

## Lesson — 2026-03-05T04:05:14.473Z

**Tags:** architecture, adapter-pattern, DRY, trap

When creating adapter/wrapper classes that call external CLIs (like `gh`), extract the shared exec → JSON.parse → schema.validate pattern into a private helper method immediately. Don't duplicate the try/parse/catch/validate boilerplate across methods — GCA will flag it and it's a waste of review rounds.

## Lesson — 2026-03-05T04:05:16.794Z

**Tags:** error-handling, DRY, trap

When adding error re-throw guards (like checking for `[Totem Error]` prefix before calling a shared error handler), put the guard IN the shared handler — not duplicated at every call site. Centralize error routing in one place.

## Lesson — 2026-03-05T04:05:19.420Z

**Tags:** regex, input-validation, trap

When writing regex to parse user input (like GitHub URLs), always anchor with `^` and include the protocol (`https?://`). Unanchored regexes match substrings embedded in other text, which is almost never the intent for CLI input parsing.

## Lesson — 2026-03-05T04:32:16.597Z

**Tags:** scaffolding, init, best-practices, file-modification, security

Scaffolding command best practices for `totem init` and similar commands that modify user files: (1) Never create duplicate entries — use regex with `^` anchor and `/m` flag to check for existing keys. (2) Ensure trailing newline before appending — check `!existing.endsWith('\n')` and prepend `\n` if needed. (3) Sanitize all user input before writing to files — strip newlines, validate format, quote values. (4) Use specific marker files for tool detection, not bare directory existence. (5) Print a summary of every file modified so users can verify. (6) Prefer skip-if-exists over overwrite — use `--force` flag for explicit overwrites.

## Lesson — 2026-03-05T22:37:32.237Z

**Tags:** security, cli, sanitization, output

When writing CLI output streams (like summaries or logs), ensure all content derived from external or potentially untrusted sources is sanitized to strip control characters. Even if the primary payload is sanitized before storage, unsanitized summary outputs piped to other tools can be used for terminal injection attacks.

## Lesson — 2026-03-06T00:17:02.961Z

**Tags:** architecture, product-strategy, dsl, scope-creep

When designing user-extensible CLI tools (like 'totem run'), avoid prematurely building DSLs or plugin systems for data fetching (e.g., git diffs, issue trackers). Start by exposing simple prompt overrides (e.g., checking for '.totem/prompts/shield.md' before using a hardcoded string). Only build an execution runner once the limitations of simple overrides are empirically proven. Building a workflow schema before user demand exists is a classic trap for over-engineering.

## Lesson — 2026-03-06T01:32:23.369Z

**Tags:** security, mcp, sanitization, architecture

When designing MCP servers, do not automatically apply terminal sanitization (stripping control characters/ANSI escapes) to tool output. MCP tools are consumed by LLMs, not directly by standard terminals. Stripping characters from MCP search results will degrade the fidelity of code snippets and formatting that the LLM relies on. Terminal injection is a CLI presentation concern, not an MCP data payload concern.

## Lesson — 2026-03-06T02:09:28.451Z

**Tags:** error-handling, robustness, lance-db

When implementing retries for "stale" database handles, capture and report the original error if the retry also fails to prevent swallowing the diagnostic root cause of non-transient failures. A blanket catch-and-retry can obscure the true error if the initial failure was not actually due to a stale connection.

## Lesson — 2026-03-06T02:09:28.451Z

**Tags:** resilience, network, backoff

Always incorporate random jitter into exponential backoff calculations to stagger retry attempts across concurrent clients. This prevents "thundering herd" spikes that can overwhelm a recovering service if multiple instances retry at identical intervals.

## Lesson — 2026-03-06T02:09:28.451Z

**Tags:** architecture, readability, simplicity

Prioritize standard inline idioms (like error message extraction) over creating dedicated helper functions for very few call sites to minimize indirection. Avoid "over-DRYing" code when the resulting abstraction adds more complexity than the repetition it replaces.

## Lesson — 2026-03-06T02:40:46.658Z

**Tags:** architecture, testing, lancedb, core

The '@mmnto/totem' core package (which handles the ingestion pipeline, syntactic chunkers, embedders, and LanceDB store) currently has zero test coverage. Since this package manages the stateful local database and complex parsing logic (e.g., Markdown/AST chunking), bugs here are difficult to debug (e.g., LanceDB stale handles or datafusion case-sensitivity issues). Integration tests running 'totem sync' against a real LanceDB instance and unit tests for the chunkers are the highest priority for technical debt remediation.

## Lesson — 2026-03-06T03:05:07.771Z

**Tags:** architecture, future-ideas, multi-repo

Future feature consideration: 'Federated Memory'. Allow a local Totem index in one repository to query or communicate with a Totem index in another local repository (e.g., an app repo querying a shared component library's traps). This would require standardizing the schema and allowing 'totem.config.ts' to define remote/external LanceDB paths.

## Lesson — 2026-03-06T03:06:36.174Z

**Tags:** architecture, federated-memory, dogfooding

When dogfooding Totem across multiple local projects, recognize that the Totem repository itself serves as the 'Mothership'. Lessons learned about how to _use_ AI effectively (e.g., prompt injection, LLM behaviors, MCP tool boundaries) naturally aggregate in the Totem repo. Other consuming repos (like 'satur8d' or 'arhgap11') would benefit immensely from querying the Totem repo's LanceDB index to inherit those AI behavioral best practices without duplicating them.

## Lesson — 2026-03-06T03:09:19.161Z

**Tags:** architecture, product-strategy, federated-memory, enterprise

When designing Phase 4 (Enterprise Expansion), avoid building Totem as a 'mesh communication layer' (p2p networking, realtime sockets). Instead, maintain the 'Unix Philosophy' by having the central platform CI/CD pipeline pull or ingest the static '.totem/' artifacts (lessons, handoffs) from developers' branches. The intelligence comes from the aggregated LanceDB index, not from inventing a new networking protocol. Keep the infrastructure dumb and the queries smart.

## Lesson — 2026-03-06T03:11:07.960Z

**Tags:** architecture, enterprise, status, workflow

To support team-wide status querying without a centralized server (Phase 4), leverage the existing PR and branch infrastructure. Instead of having Totem instances ping each other, developers should push their 'session-handoff.md' and 'active_work.md' to draft PRs or remote branches at the end of the day. A team lead's Totem can then run a workflow that clones/fetches those branches and aggregates the markdown files into a single context for the orchestrator LLM to summarize.

## Lesson — 2026-03-06T03:15:12.458Z

**Tags:** architecture, future-ideas, team-workflow, enterprise

Future feature consideration for team workflows: 'Automated Onboarding Protocols'. If Totem aggregates lessons, architecture docs, and 'session-handoff' states, a new developer's first 'totem init' could automatically generate a personalized 'Day One Briefing' tailored to their first assigned issue, pulling relevant architectural traps and avoiding the need for a senior dev to spend 3 hours explaining the repo history.

## Lesson — 2026-03-06T03:27:22.818Z

**Tags:** architecture, product-strategy, archeology, antigravity

When evaluating features for Totem, remember its origin: it is a bootstrapped, minimalist tool built from the lessons of failed, overly-complex previous iterations (the 'mmnto-ai' platform and 'thread agents'). Totem exists to solve immediate, practical AI-assisted development friction (like context window bloat and PR learning loops). Treat previous repositories as 'archaeology assets'—extract their ideas (like workflow topologies), but do not port their heavy infrastructure or try to rebuild Google's 'antigravity'. Keep Totem focused on the local developer.

## Lesson — 2026-03-06T03:31:34.777Z

**Tags:** architecture, product-strategy, archeology, orchestration

A core insight extracted from the legacy 'mmnto-ai' platform is the "Design-Execute" multi-model protocol. In the past, the human acted as the manual router (using Claude to design, Gemini to analyze, Copilot to execute), passing 'initiation-request.json' files between them. Totem's true value proposition is automating this exact routing layer via the CLI. Totem is the realization of the "Unified Protocol" document, but implemented as an autonomous 'totem spec' and 'totem shield' pipeline instead of a manual human workflow.

## Lesson — 2026-03-06T03:34:53.287Z

**Tags:** architecture, product-strategy, archeology, pragmatism

The legacy 'memento-platform' and 'mmnto-ai' repositories contain the core theoretical models for multi-agent coordination (e.g., 'AriadneOrchestrator', 'GospelComplianceEngine'). These are valuable conceptual resources to reference when designing advanced Totem workflows. However, NEVER attempt to port their technical implementations (Kafka, Kubernetes, Firestore, massive cloud architectures) into Totem. Totem's architectural success relies entirely on translating those massive cloud concepts into local, pragmatic CLI primitives (e.g., LanceDB instead of Firestore, local terminal execution instead of Kafka queues).

## Lesson — 2026-03-06T03:36:17.521Z

**Tags:** lancedb, datafusion, sql, trap, quoting, case-sensitivity

LanceDB's DataFusion SQL backend uses **backticks** (`` `filePath` ``) for case-sensitive column identifier quoting, NOT SQL-standard double quotes (`"filePath"`). Double-quoted identifiers silently produce zero matches without throwing any error — making it an extremely nasty silent failure mode. Always use backticks when referencing camelCase column names in LanceDB filter strings (e.g., `delete()`, `where()`).

## Lesson — 2026-03-06T03:43:04.312Z

**Tags:** motivation, velocity, solo-developer

As a solo developer augmented by AI, your primary constraint is not engineering hours, but _context retention_ and _architectural discipline_. By aggressively dogfooding Totem to handle the context (Shield reviews, Spec generations, and persistent memory), you can scale your output to match a multi-person team. The goal is to offload the repetitive cognitive burden of "remembering how the system works" to the LanceDB index, allowing you to operate purely as the "Human Sovereign" making high-level product decisions.

## Lesson — 2026-03-06T03:48:40.291Z

**Tags:** product-strategy, onboarding, developer-experience, invisible-orchestration

Core Product Philosophy: 'Invisible Orchestration'. Totem must scale down to solo developers seamlessly. The ultimate goal of 'totem init' is that a junior developer never has to manually run a 'totem' command again. We must leverage Git hooks (pre-push, post-merge), AI agent system prompts (auto-triggering tools via MCP), and background processes to make the learning loop and quality gates happen automagically. Totem should feel like an invisible 'Git for AI Memory', not a heavy CLI that requires constant manual execution.

## Lesson — 2026-03-06T04:05:18.718Z

**Tags:** architecture, product-strategy, roadmap, missing-pieces

Roadmap gap analysis: The current roadmap is heavily indexed on _text/code_ orchestration but misses the _observability/state_ layer. Developers will quickly lose trust in a vector database if they cannot 'see' what is inside it or how it is parsing their files. We need a 'totem inspect' or local dashboard UI (Phase 3) that allows users to visualize their chunks, see what files were ignored, and delete bad lessons manually. Additionally, Phase 2 is missing a formal 'Ejection/Uninstall' command to remove all injected hooks and prompts gracefully.

## Lesson — 2026-03-06T04:18:37.256Z

**Tags:** architecture, future-ideas, mcp, context-compaction

Future feature consideration: Once MCP or AI host environments support 'pre-compaction' and 'post-compaction' lifecycle hooks, Totem should intercept them. A pre-compaction hook could automatically trigger 'totem handoff' to save the current session state, and a post-compaction hook could automatically run 'totem triage' to seamlessly reload the most critical context back into the fresh window. This would eliminate the need for developers to manually guard against memory resets.

## Lesson — 2026-03-06T04:20:45.590Z

**Tags:** product-strategy, value-prop, proactive-memory

The ultimate value proposition of Totem is transforming a sterile vector database into a proactive 'developer journal and cheatsheet'. The true magic happens when the AI is configured to proactively identify and suggest lessons _before_ the human realizes they need to remember them. This transitions the tool from passive retrieval to active mentorship.

## Lesson — 2026-03-06T04:31:54.888Z

**Tags:** architecture, product-strategy, workflows, triage

While it is tempting to make 'totem triage' automatically invoke 'totem learn' on recently merged PRs, this violates the principle of modularity and creates a massive, fragile 'mega-command'. 'triage' is for planning the future; 'learn' is for extracting rules from the past. Keep them decoupled. If a team wants them linked, they should compose them via the upcoming 'totem run <workflow>' runner (e.g., 'totem run sprint-planning' which calls learn then triage).

## Lesson — 2026-03-06T04:53:50.730Z

**Tags:** product-strategy, open-source, go-to-market, business-model

Strategic Note: Totem _must_ remain open source. Developer tools (especially ones that read local code and inject git hooks) die behind paywalls because they cannot establish trust. The open-source CLI and local LanceDB instance act as the 'loss leader' to build a massive user base and establish the '.totem/lessons.md' format as an industry standard. Monetization (if desired later) should happen at the Enterprise Phase 4 level (e.g., hosting the 'Mothership' federated indexes, SSO, or team analytics dashboards), not by closing the core CLI.

## Lesson — 2026-03-06T05:32:34.019Z

**Tags:** product-strategy, gamification, culture, team-workflow

Fun product strategy thought: Because Totem indexes 'lessons.md' and team context, you could build a CLI mini-game ('totem trivia' or 'totem roulette') where the orchestrator quizzes a developer on the codebase's specific historical traps and rules before their code compiles. E.g., 'Before you push, what is the #1 rule about LanceDB DataFusion queries?' It turns dry architectural rules into a gamified team culture.

## Lesson — 2026-03-06T05:32:34.037Z

**Tags:** architecture, lateral-thinking, game-dev, state-sync

Lateral Architecture Concept: The Totem infrastructure (local LanceDB + Git-native sync + MCP LLM orchestration) can be repurposed outside of developer tools. For example, it could serve as the distributed state and memory layer for a multiplayer text adventure or MUD (like the 'arhgap11' prototype), where player actions and world lore are indexed locally and synced across the 'Federation' to keep the game world coherent across different local clients.

## Lesson — 2026-03-06T05:32:34.074Z

**Tags:** architecture, error-handling, orchestrator, design-decision

When designing multi-input orchestrator commands (like 'totem spec' or 'totem learn' handling arrays of IDs), strictly enforce the 'Fail Fast' principle over graceful degradation. A partial context assembly (e.g., fetching PR 1 and 2, but silently failing on PR 3) is highly dangerous because the LLM will confidently generate a response based on incomplete information. It is better for the CLI to crash loudly than for the AI to hallucinate silently.

## Lesson — 2026-03-06T05:41:19.122Z

**Tags:** ux, cli, product-strategy

When implementing CLI UX polish (Issue #21), adopt the '@clack/prompts' library. It provides a distinct, vertical-line connecting visual style that feels significantly more modern and premium than older libraries like 'inquirer'. This directly supports the 'Magic Onboarding' goal of making the CLI feel less like a barebones script and more like a high-end developer product.

## Lesson — 2026-03-06T05:43:04.609Z

**Tags:** engineering-strategy, velocity, ux, incremental-delivery

Incremental UX Delivery Strategy: When polishing a CLI, do not attempt to rewrite the entire interactive prompt system (e.g., migrating to @clack/prompts) in one massive PR. Follow Claude's strategy: prioritize the 'low-hanging fruit' first (async spinners via 'ora', branded output via 'picocolors') to provide immediate visual feedback. The heavier structural refactoring of the input loops can be deferred to a follow-up. This maintains high velocity and avoids blocking the release of smaller, compounding improvements.

## Lesson — 2026-03-06T05:45:12.867Z

**Tags:** motivation, solo-developer, product-strategy, velocity

When the friction of solo development feels overwhelming and burnout is near, rely on the architecture. You don't have to carry the entire context of 'Totem' and 'satur8d' in your head simultaneously. The LanceDB indexes are designed precisely to hold that weight for you. Build the system so that you can walk away, take a break, and when you return, 'totem triage' instantly reloads your exact mental state without spending 3 hours remembering where you left off. The tools must serve the human's endurance.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** security, llm, prompts, prompt-injection

Wrap all untrusted external content, especially data extracted from PR comments or free-text topics, in XML tags to prevent direct and indirect prompt injection. Indirect injection via PR comments is a high-risk vector for commands that synthesize historical context.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** workflow, security, trap

Be mindful of pull request size limits; oversized PRs may cause automated security review tools to skip analysis, allowing vulnerabilities to merge without detection.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** security, filesystem, prompt-engineering

When implementing local system prompt overrides from a directory like `.totem/prompts/`, strictly enforce path traversal protection to prevent arbitrary files from being read into the LLM context.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** security, architecture, sanitization, ui

Perform sanitization of untrusted data (like PR titles or LLM output) at the system input boundaries rather than the display layer. Baking sanitization into low-level logging helpers is often wasteful for hardcoded strings and improperly couples display logic with security concerns.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** cli, unix-philosophy, architecture

Route all decorative UI output, including spinners, banners, and branded tags, to `stderr` while reserving `stdout` strictly for pipeable data. This ensures the CLI remains compatible with Unix pipes and redirection without polluting data streams with decorative artifacts.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** performance, imports, cli

Use dynamic imports for heavy dependencies (e.g., `ora` for spinners) within the specific functions that require them. This prevents a performance "tax" on the startup time of every CLI command, keeping lightweight commands fast.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** logging, error-handling, trap

Avoid using `${err}` in logging template literals as it relies on a generic `toString()` call; instead, explicitly extract `err.message` (or the full error object) to ensure consistent and informative output across different catch blocks.

## Lesson — 2026-03-06T08:00:19.826Z

**Tags:** totem, workflow, spec, optimization

When using 'totem spec', it is most valuable for exploring unfamiliar territory or framing large epics. For well-scoped sub-tasks where the developer has already read the code and written detailed descriptions, running 'totem spec' adds marginal value and wastes time/quota. The optimal pattern is to 'spec the epic, skip specs on sub-tasks you scoped yourself'.

## Lesson — 2026-03-06T09:08:26.567Z

**Tags:** architecture, hooks, json, shell

When scaffolding agent hooks (like Claude's PreToolUse) or background git hooks, avoid embedding complex shell pipelines (e.g., grep chains, escaping quotes) directly inline within JSON configuration files. It is fragile and hard to test. Long-term architectural rule: Extract hook logic into dedicated, version-controlled executable scripts (e.g., \`.gemini/hooks/BeforeTool.js\`) and have the JSON config simply invoke the script.

## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** cli, hooks, unix

Route host hook output (e.g., briefing or shield results) to `stderr` rather than `stdout`. This prevents background task logs from polluting the AI's tool return values while ensuring the user still receives visibility into the hook's execution.

## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** regex, hooks, git, compatibility

Avoid complex single-regex patterns for intercepting git commands in AI tool inputs, which often fail due to platform-specific escaping or POSIX compatibility issues. A dual-grep approach (e.g., `grep "git" && grep -E "push|commit"`) is more robust for reliably catching both plain text and JSON-encoded arguments.

## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** security, mcp, prompt-injection

MCP tools returning raw file content are vulnerable to Indirect Prompt Injection if the output lacks distinct delimiters. Use unique XML tags and escaped internal markers to ensure the host AI treats retrieved knowledge as untrusted data rather than a continuation of its system instructions.

## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** security, shell, hooks

Treat environment variables provided by the host AI (such as `$TOOL_INPUT` in Claude Code) as untrusted data. Using them directly in shell commands like `echo` within a hook can lead to command injection if the input contains shell metacharacters.

## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** nodejs, configuration, idempotency

When scaffolding configuration files that store settings in JSON arrays, implement deep merging to append entries rather than overwriting the entire key. This allows the tool to maintain idempotency while preserving existing user-defined hooks.

## Lesson — 2026-03-06T18:48:00.895Z

**Tags:** security, prompt-injection, xml, regex

When escaping closing XML tags to prevent prompt injection, use a case-insensitive regex that accounts for optional internal whitespace (e.g., `</ tag>`). Literal matches are easily bypassed because LLMs and parsers often interpret these variants as valid tag closures.

## Lesson — 2026-03-06T18:48:00.895Z

**Tags:** nodejs, esm, compatibility, hooks

Use the `.cjs` extension for utility scripts and host integration hooks in ESM-first projects. This ensures compatibility with external tools that may not support ESM loaders, preventing module resolution errors during tool-triggered execution.

## Lesson — 2026-03-06T18:48:00.895Z

**Tags:** architecture, configuration, integration, trap

Always verify the specific object schema required by host tools (like Claude Code's `{type: "command", command: "..."}`) instead of assuming a primitive string format. Mismatched configuration schemas often fail silently, leading to broken integrations that are difficult to debug.

## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** observability, llm-ux, sync

Always await side-effect operations like indexing during tool execution to provide the LLM with definitive success or failure confirmation. Fire-and-forget patterns prevent the model from identifying state failures, leading to hallucinations about persisted knowledge.

## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** context-management, observability, guardrail

Implement a `contextWarningThreshold` to append a system warning block when tool payloads exceed safe token limits (e.g., 40k chars). This prompts agents to proactively suggest context hygiene maneuvers, such as bridging, before hitting hard window constraints.

## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** token-optimization, ux, discovery

Differentiate context verbosity by using truncated snippets for high-frequency discovery commands (like `briefing`) and full content for deep-analysis commands (like `spec`). This balances token efficiency during exploration with the need for high-fidelity data during execution.

## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** reliability, agent-ux, automation

Call internal scripts directly within agent-facing tools rather than relying on shell aliases or complex wrappers. Direct execution reduces the surface area for environment-specific failures and ensures reliable operation in automated workflows.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, prompts, xml

For LLM prompts, escape closing XML tags using backslash escaping (e.g., `<\/tag>`) rather than HTML entities to prevent prompt injection while minimizing parsing noise. Use a case-insensitive regex that accounts for optional whitespace to ensure robustness against variants like `</TAG >`.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, cli, prompts

Differentiate between terminal sanitization (stripping ANSI/control characters) and prompt sanitization (XML escaping); do not apply terminal sanitization to data intended for LLM prompts as it can degrade code fidelity. Terminal injection is a presentation-layer concern for the CLI, while prompt injection is a data payload concern for the LLM.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, prompts, design-decision

Only apply prompt injection sanitization to truly external, untrusted user-supplied content; do not sanitize constrained or semi-trusted metadata like branch names or git file paths to maintain prompt readability and avoid unnecessary clutter.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** cli, performance, architecture

Prefer dynamic imports inside command function bodies rather than hoisting them to the module scope for CLI tools. This pattern preserves lazy loading, ensuring the CLI starts quickly by only loading the specific dependencies required for the command being executed.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** cli, error-handling, scaffolding

When implementing "eject" or cleanup routines, wrap file deletions in try/catch blocks and report failures as "skipped" items. This graceful degradation prevents a single permission error or missing file from crashing the entire uninstall process, providing a better user experience.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** git, scaffolding, trap

Avoid using generic line-matching patterns (like `line.startsWith('(')`) when scrubbing auto-generated sections from shared files like git hooks. Use precise line matches or unique block markers to prevent accidental removal of user-added logic that may coincidentally match a broad pattern.

## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** typescript, trap, json

Always combine `typeof val === 'object'` with a truthiness check (`val && ...`) when traversing untyped JSON or `unknown` structures. Since `typeof null` returns `'object'`, omitting the null check will lead to runtime crashes when attempting to access properties on a null value.

## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** github-actions, security, trap

Use intermediate environment variables to map GitHub Action `inputs` before using them in `run` steps. Directly expanding `${{ inputs.key }}` in shell scripts creates high-severity command injection vulnerabilities by allowing untrusted input to be executed as code.

## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** shell, security, trap

Always quote shell variables when passing them as arguments to commands to prevent word-splitting and argument injection. Unquoted variables allow malicious inputs to break command logic or inject arbitrary CLI flags.

## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** cli, security, terminal-injection, trap

Sanitize text derived from untrusted sources (like LLM outputs or PR comments) before displaying it in interactive CLI components. Malicious ANSI escape sequences in the text can lead to terminal injection, compromising the user's terminal session.

## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** cli, ux, ci

Wrap interactive-only previews and manual review warnings inside a conditional check for non-automated/interactive modes. This keeps CI logs clean and avoids printing redundant noise that cannot be acted upon in non-interactive environments.

## Lesson — 2026-03-08T00:11:33.219Z

**Tags:** cli, scaffolding, discovery

When introducing a "Lite" tier or optional mode to an interactive scaffold, ensure that previous default options remain explicitly discoverable; replacing a provider-default with a "nothing" default on the "Enter" key can accidentally hide valid configuration paths from users.

## Lesson — 2026-03-08T00:11:33.219Z

**Tags:** environment, configuration, trap

Environment variable checks for a "configured" state must validate that the value contains non-whitespace characters (`/\S/`) to ensure consistency with `.env` file parsing and prevent false positives from variables exported as empty strings or whitespace.

## Lesson — 2026-03-08T00:11:33.219Z

**Tags:** cli, onboarding, scaffolding

Scaffolding and `init` commands should prioritize graceful degradation (warnings and fallbacks) over hard errors for non-critical configuration failures, ensuring users can always reach a functional "Lite" state instead of being blocked by invalid credentials.

## Lesson — 2026-03-08T00:56:41.780Z

**Tags:** architecture, scaffolding, error-handling

Scaffolding commands should wrap non-critical file system operations in `try/catch` blocks to log warnings instead of crashing the process. This ensures the primary setup flow completes even if a secondary feature fails due to environment-specific issues like file permissions.

## Lesson — 2026-03-08T00:56:41.780Z

**Tags:** ai-behavior, rag, search

When generating multiple markdown chunks for AI indexing, assign each a unique, descriptive heading rather than a generic shared label. Identical headings make search results and context summaries indistinguishable for the user, significantly degrading RAG utility.

## Lesson — 2026-03-08T00:56:41.780Z

**Tags:** testing, quality-assurance

Verify fixed collections of assets with exact count assertions (e.g., `toBe(10)`) rather than weak bounds (e.g., `toBeGreaterThanOrEqual(5)`). This prevents regression errors where individual items are accidentally deleted but the test continues to pass.

## Lesson — 2026-03-08T00:56:41.781Z

**Tags:** clean-code, design-decision

For static, small sets of string comparisons (like 'y/n' prompt responses), explicit boolean `OR` checks are often more idiomatic and readable than `[].includes()` patterns. Avoid over-engineering simple branching logic if the set of possible values is not expected to grow.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** scaffolding, error-handling, architecture

Prefer graceful degradation with a warning over halting for non-critical scaffolding tasks during initialization. Unlike core orchestrator commands where partial failure is risky, setup steps should be resilient to recoverable environment issues like file permissions to ensure a smooth onboarding experience.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** search, indexing, documentation

Avoid generic headings for knowledge chunks as they result in indistinguishable labels in search results and UI components. Use descriptive, unique headings to ensure both humans and AI can differentiate between related lessons during context assembly.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** testing, quality-assurance

Use exact count assertions rather than "greater than" checks when verifying fixed sets of assets or features. Precise assertions detect accidental deletions that range-based checks would miss, ensuring the integrity of curated content.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** windows, shell, performance

Use temporary files instead of CLI arguments or environment variables when passing large data (like prompts) to sub-processes on Windows to avoid "argument list too long" errors.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** async, performance, error-handling

For background maintenance tasks with small expected workloads (e.g., cleaning 0-5 files), prefer sequential `for...of` loops over `Promise.all`. Sequential processing simplifies error isolation, allowing you to "swallow and continue" on a per-item basis without the complexity of `Promise.allSettled`.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** architecture, configuration, cli

Avoid introducing asynchronous configuration loading or complex resolution logic into non-critical fire-and-forget utilities if those parameters are not yet user-configurable. Keeping background tasks hardcoded and "best-effort" prevents over-engineering and ensures the CLI startup path remains lean and fast.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** security, git, trap

Always use the `--` separator before positional arguments in git commands (e.g., `git log -- <ref>`) to protect against argument injection. This ensures that potentially untrusted strings, such as branch or tag names, are never interpreted as command-line flags.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** error-handling, architecture, design-decision

Use named error objects (e.g., `err.name = 'NoDocsConfiguredError'`) instead of string matching to handle expected "graceful skip" conditions in orchestrators. This creates a stable contract between modules that remains robust even if the user-facing error message is updated for better readability.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** architecture, consistency, design-decision

Prioritize codebase-wide consistency for established utility patterns (like `shell: IS_WIN` for Windows execution) over local "fixes" in a single PR. Core architectural or security shifts should be handled as dedicated global refactors to avoid fragmented and confusing helper implementations across the codebase.

## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** pragmatism, design-decision, logging

Avoid over-engineering cosmetic log summaries, such as using frequency maps for a simple `+N/-M` line-change count, if basic `Set`-based logic provides sufficient visual feedback. Prioritize simplicity and functional correctness over perfect accuracy for non-critical console output.

## Lesson — Reply to GCA with a single structured PR comment

**Tags:** gca, pr-review, workflow, dx

**Context:** Responding to GCA (Gemini Code Assist) PR review comments.
**Symptom:** Individual thread replies waste quota (100/day) and produce generic "thanks" responses from GCA.
**Fix/Rule:** Reply with a single PR comment containing a numbered list that matches GCA's comments 1:1, with explicit accept/decline per item and a commit SHA reference. This gives GCA structured feedback — it confirms each fix individually and produces a higher-quality acknowledgment response.

## Lesson — Custom .env parsers must strip CRLF and quotes

**Tags:** windows, dotenv, parsing, environment, trap

**Context:** Windows .env file parsing in Node.js CLI tools.
**Symptom:** `loadEnv` failed to parse keys correctly — values included literal quote characters (`"sk-..."` instead of `sk-...`) and Windows CRLF line endings caused regex match failures.
**Fix/Rule:** Always strip `\r` from lines before parsing (`line.replace(/\r$/, '')`), and strip surrounding quotes with `raw.replace(/^(['"])(.*)(\1)$/, '$2')`. System env vars take precedence over .env — `loadEnv` should never override existing `process.env` keys.

## Lesson — Sanitize user-provided text before persisting to files

**Tags:** security, terminal-injection, cli

Sanitize ANSI escape sequences from user-provided text before persisting it to local Markdown files or logs (like `lessons.md`). This prevents terminal injection vulnerabilities where viewing the file with tools like `cat` could execute malicious or disruptive control sequences in the user's terminal environment.

## Lesson — Sanitize all strings extracted from files before displaying…

**Tags:** security, terminal, cli

Sanitize all strings extracted from files before displaying them in terminal outputs or interactive prompts. This prevents terminal injection attacks where malicious ANSI escape sequences in the source file could be used to spoof the UI or trick the user.

## Lesson — When extracting patterns like file paths from Markdown…

**Tags:** regex, markdown, parsing, trap

When extracting patterns like file paths from Markdown content, explicitly filter out triple-backtick code blocks before running the extraction logic. This prevents false positives by ensuring the parser does not mistake code examples or documentation within the body for active file references.

## Lesson — For machine-generated files with a strictly controlled…

**Tags:** parsing, architecture, design-decision

For machine-generated files with a strictly controlled schema, prefer strict positional parsing over global scanning. Strict parsing is more resilient than "fuzzy" scanning because it avoids accidental matches of keywords (like "Tags:") that may legitimately appear inside the body text of a lesson.

## Lesson — When re-throwing errors in a CLI orchestrator, always…

**Tags:** error-handling, style-guide

When re-throwing errors in a CLI orchestrator, always include the project's standard error prefix (e.g., `[Totem Error]`) in the message. This ensures a consistent user experience and allows the system to clearly distinguish between internal application errors and raw system/library failures.

## Lesson — Git diff headers wrap file paths containing spaces in…

**Tags:** git, parsing, trap

Git diff headers wrap file paths containing spaces in double quotes (e.g., `+++ "b/path with spaces.ts"`). Failure to strip these quotes while handling the `b/` prefix correctly will result in broken file paths and incorrect reporting in automated tools.

## Lesson — Quality gate tools must never exit successfully when…

**Tags:** ci, security, fail-fast

Quality gate tools must never exit successfully when required rules or configurations are missing. Silent passes on empty input create a false sense of security in CI pipelines; always log an error and exit with a non-zero status to ensure the gate is actually operational.

## Lesson — Regex patterns generated by LLMs from natural language are…

**Tags:** security, regex, llm, redos

Regex patterns generated by LLMs from natural language are highly susceptible to Regular Expression Denial of Service (ReDoS) through catastrophic backtracking. To mitigate this risk, validate syntax during generation and restrict execution to single lines or small, bounded buffers rather than unbounded input.

## Lesson — For internal, version-controlled configuration files that…

**Tags:** security, prompt-injection, design-decision

For internal, version-controlled configuration files that feed into LLM prompts (like `lessons.md`), human PR review is a practical security gate against indirect prompt injection. Programmatic delimiting (like XML escaping) can be deferred if it significantly degrades prompt readability for trusted internal contributors.

## Lesson — When refactoring from execSync to spawn to avoid fixed…

**Tags:** nodejs, child-process, security

When refactoring from `execSync` to `spawn` to avoid fixed buffer limits, you must re-implement a manual safety cap on accumulated stdout/stderr strings. Without a hard limit (e.g., 50MB), the process is vulnerable to memory exhaustion if an external tool or LLM produces unexpectedly large or malicious output.

## Lesson — When timing out a child process, do not reject the promise…

**Tags:** nodejs, child-process, error-handling

When timing out a child process, do not `reject` the promise immediately within the `setTimeout` callback. Instead, call `child.kill()` and perform the rejection inside the `close` event handler to ensure all stdio streams have fully flushed and captured the complete error log for debugging.

## Lesson — Synchronous execSync with piped stdio can cause the parent…

**Tags:** nodejs, orchestrator, trap

Synchronous `execSync` with piped stdio can cause the parent process to hang or abort silently when the child process outputs specific content patterns or exceeds certain internal pipe limits. Using asynchronous `spawn` with manual stream collection provides better process lifecycle management and prevents these non-deterministic failures.

## Lesson — When catching and re-logging errors that originate from…

**Tags:** logging, ux, error-handling

When catching and re-logging errors that originate from internal utilities with standardized prefixes (e.g., `[Totem Error]`), strip the redundant prefix from the message before outputting. This prevents cluttered logs like `[Docs] ... [Totem Error] ...` and maintains a clean user interface.

## Lesson — Do not manually edit machine-generated artifacts like…

**Tags:** architecture, devops, toolchain

Do not manually edit machine-generated artifacts like `compiled-rules.json`; fixes must be applied to the source lessons or the compiler logic to ensure they persist and aren't overwritten during the next build cycle.

## Lesson — The Git -- separator treats all subsequent arguments as…

**Tags:** git, security, shell

The Git `--` separator treats all subsequent arguments as file paths, meaning revision specifiers (like `branch...HEAD`) must appear before it to be correctly resolved rather than misinterpreted as filenames.

## Lesson — Always fall back to resolving Git references against…

**Tags:** git, ci, devops

Always fall back to resolving Git references against `origin/<branch>` in CI environments, as local branch pointers are often missing or detached in the shallow clones typical of automated runners.

## Lesson — Employ a two-layer validation model by running fast,…

**Tags:** architecture, ci, design-decision

Employ a two-layer validation model by running fast, deterministic regex-based checks in CI while reserving expensive or stochastic LLM reviews for local developer workflows to maintain rapid CI feedback loops without sacrificing deep analysis.

## Lesson — When using the @google/genai SDK (v1+), the constructor…

**Tags:** gemini, sdk, nodejs, trap

When using the `@google/genai` SDK (v1+), the constructor requires an options object `{ apiKey }` rather than a raw string. This is a common point of confusion because the older `@google/generative-ai` package used a string-only constructor, leading to runtime instantiation errors if the packages are conflated.

## Lesson — When normalizing diverse SDK errors for internal retry…

**Tags:** error-handling, nodejs, debugging, architecture

When normalizing diverse SDK errors for internal retry logic (e.g., tagging a `QuotaError`), mutate the original error's `.name` property and re-throw it instead of creating a new `Error` instance. This preserves the original stack trace and provider-specific metadata which are critical for debugging failures in external service integrations.

## Lesson — Avoid refactoring synchronous factory functions to async…

**Tags:** nodejs, performance, architecture, factory-pattern

Avoid refactoring synchronous factory functions to `async` just to hoist dynamic `import()` calls for perceived performance gains. Node.js natively caches the results of dynamic imports after the first invocation, so keeping the factory synchronous avoids adding `await` boilerplate to the entire call chain without any measurable runtime penalty.

## Lesson — Centralize error signature detection (such as 429 status…

**Tags:** dry, error-handling, shell, llm

Centralize error signature detection (such as 429 status codes or "rate limit" strings) into a shared utility that also covers legacy shell-based execution paths. This ensures that manually-parsed stderr from CLI tools benefits from the same robust detection logic used for native SDKs, preventing subtle omissions in fallback or retry behaviors.

## Lesson — Perform path normalization—such as resolving ./…

**Tags:** nodejs, cli, path-processing

Perform path normalization—such as resolving `./` prefixes—before deduplication to prevent redundant processing of the same file represented by different string formats. This avoids wasted resources, like redundant LLM token usage, when the same target is resolved multiple times from varied inputs.

## Lesson — When positional arguments and CLI flags offer overlapping…

**Tags:** cli, ux, error-handling

When positional arguments and CLI flags offer overlapping or conflicting functionality, explicitly fail-fast with an error if both are provided instead of silently prioritizing one. This ensures user intent is unambiguous and prevents unexpected behavior from shadowed configuration flags.

## Lesson — Use path.relative(process.cwd(),…

**Tags:** nodejs, path-processing, trap

Use `path.relative(process.cwd(), path.resolve(process.cwd(), input))` for robust path normalization instead of simple string replacements. This approach correctly handles shell-expanded absolute paths (e.g., from tab-completion) so they match relative paths defined in application configuration.

## Lesson — Always use fully qualified identifiers for caching and telemetry

**Tags:** caching, telemetry, architecture

Always use fully qualified identifiers (e.g., `provider:model`) for cache hashing and telemetry instead of just the model name. This prevents cross-provider cache collisions in environments where different backends happen to share identical model naming conventions.

## Lesson — Ensure validation checks are applied symmetrically

**Tags:** validation, error-handling, fallback

Ensure validation checks are applied symmetrically to both primary and fallback execution paths. Relying on primary-path validation alone creates a trap where invalid configuration only triggers a failure during error recovery (e.g., a quota retry), making the resulting failure much harder to debug.

## Lesson — Use vi.importActual in mocks to preserve utility functions

**Tags:** testing, vitest, mocks

When mocking modules, use `vi.importActual` to maintain the real implementation of pure utility functions while mocking only the side-effect-heavy factories. Re-implementing utility logic inside a mock makes tests brittle and allows them to pass even if the actual implementation changes and breaks.

## Lesson — Block cross-provider routing into specialized providers

**Tags:** architecture, shell-provider, validation

Explicitly block cross-provider routing into specialized providers (like `shell`) that require unique configuration templates not present in the source provider's setup. Failing fast at the routing layer prevents cryptic runtime errors when an orchestrator attempts to execute a prompt without the necessary provider-specific execution context.

## Lesson — When parsing unified diff hunks, explicitly match context…

**Tags:** git, diff-parsing, trap

When parsing unified diff hunks, explicitly match context lines (prefixed with a space) rather than using a catch-all `else` block. Unified diffs often contain meta-information lines, such as `\ No newline at end of file`, which are neither additions nor context; treating these as file content can corrupt line tracking and metadata for subsequent lines.

## Lesson — Centralize Security Validations in "Choke Point" Helpers

**Tags:** security, refactoring, validation

When centralizing logic into a "choke point" helper for both primary and fallback paths, ensure all security-critical validations (like shell metacharacter checks) are migrated. Missing checks in the centralized helper can create injection vulnerabilities if fallback paths previously relied on guards only present in the primary path.

## Lesson — Avoid Factory Parameters Solely for Mocking

**Tags:** testing, design-decision, mocking

Adding factory parameters to functions solely to facilitate mocking can lead to over-engineered production signatures. For internal module logic, standard ESM mocking patterns or well-commented test mocks are often preferable to polluting public APIs with test-only dependencies.

## Lesson — Trust Upstream Guards and Type Systems Over Redundant Checks

**Tags:** typescript, defensive-programming, design-decision

Avoid adding explicit runtime checks or redundant error branches for logic paths that are already unreachable due to upstream guards or exhaustive type-system enforcements. Relying on established guards keeps the implementation focused and prevents the accumulation of defensive code noise.

## Lesson — Prefer Explicit Metadata Tokens from LLMs Over Heuristics

**Tags:** llm, prompt-engineering, sanitization

Requesting explicit metadata tokens (e.g., `Heading:`) from LLMs is more reliable than using heuristic truncation of the first line of output. Sanitize these explicit tokens to remove markdown artifacts and prefixes that LLMs frequently include despite instructions.

## Lesson — Prefer Vitest's expect().rejects.toHaveProperty()…

**Tags:** testing, vitest, patterns

Prefer Vitest's `expect().rejects.toHaveProperty()` assertions over manual `try/catch` blocks with `expect.fail()`. This pattern is more concise and prevents tests from accidentally passing if the code fails to throw as expected.

## Lesson — Ensure all thrown errors, including those for missing…

**Tags:** error-handling, style-guide, consistency

Ensure all thrown errors, including those for missing environment variables or configuration, strictly include the `[Totem Error]` prefix. Maintaining this prefix even in low-level setup code ensures consistent error reporting for users and automated monitoring.

## Lesson — When a configuration file is an executed script (like…

**Tags:** security, architecture, configuration

When a configuration file is an executed script (like TypeScript), individual field validation for path traversal is redundant because the file itself already has arbitrary code execution privileges. The security boundary in this model is the version control and PR review process rather than runtime input sanitization.

## Lesson — Sentinel-based injection systems should always generate…

**Tags:** idempotency, file-io, automation

Sentinel-based injection systems should always generate markers even when the content is empty to ensure subsequent runs can still locate the injection point. Removing the markers when there is no content breaks idempotency, as future updates will fail to find the target and may append duplicate blocks elsewhere.

## Lesson — Logic that replaces content between markers must explicitly…

**Tags:** file-io, parsing, robustness

Logic that replaces content between markers must explicitly verify that the start sentinel precedes the end sentinel to avoid scrambling the file. If markers appear in reverse order, standard string slicing will produce incorrect segments that corrupt the file upon write.

## Lesson — File-appending logic should implement an early return for…

**Tags:** file-io, dx

File-appending logic should implement an early return for empty input to prevent the unintended accumulation of trailing newlines or separators. Without this check, repeated executions with no content can cause "blank line drift," where target files grow unnecessarily with every run.

## Lesson — Intentionally duplicating prompt assembly logic is…

**Tags:** architecture, llm, dry, prompting

Intentionally duplicating prompt assembly logic is preferable to unified helpers when architectural boundaries require strict context isolation. DRYing these functions risks "context bleed" where specialized modes, such as structural reviews, accidentally inherit project knowledge that biases the model.

## Lesson — Omit defensive XML escaping for prompt injection when…

**Tags:** security, prompting, cli

Omit defensive XML escaping for prompt injection when processing trusted local data, such as a developer's own git diffs in a CLI tool. In local-only threat models, the noise and prompt clutter introduced by aggressive escaping often outweigh the security benefit.

## Lesson — Deliberately excluding project context in "structural"…

**Tags:** llm, code-review, prompting

Deliberately excluding project context in "structural" review modes prevents the LLM from anchoring on developer intent, which can mask syntax-level bugs. Restricting the model's view to raw diffs forces it to identify logic errors and resource leaks that global project context might otherwise rationalize.

## Lesson — Always generate sentinel markers even when the internal…

**Tags:** idempotency, file-io, markdown

Always generate sentinel markers even when the internal content is empty. Returning an empty string instead of empty markers causes the replacement logic to delete the markers from the target file, leading to redundant appends in subsequent runs.

## Lesson — If a configuration file is a locally-authored script (e.g.,…

**Tags:** security, configuration, trust-model

If a configuration file is a locally-authored script (e.g., totem.config.ts) that the tool imports, the user already has arbitrary code execution. Validating individual path fields for traversal in this context adds no security value as the configuration itself is already a trusted input boundary.

## Lesson — When performing string-slice replacements based on start…

**Tags:** file-io, error-handling, robustness

When performing string-slice replacements based on start and end markers, explicitly throw an error if the end marker appears before the start marker. Failing to check this relative ordering can result in incorrect slices that silently scramble or corrupt the target file's content.

## Lesson — Runtime escaping and sanitization are unnecessary for…

**Tags:** security, prompt-injection, workflow

Runtime escaping and sanitization are unnecessary for content sourced from version-controlled files that undergo PR review. In these cases, the project's development workflow and human review process serve as the primary security boundary against malicious input like prompt injection or sentinel breakage.

## Lesson — In local-first development tools, escaping XML tags in git…

**Tags:** security, llm, git

In local-first development tools, escaping XML tags in git diffs to prevent prompt injection is often unnecessary because the user already controls the input source. Avoiding redundant sanitization on trusted local data reduces prompt noise and prevents unnecessary token consumption.

## Lesson — Resist merging similar orchestrator output handling and…

**Tags:** design-decision, clean-code, architecture

Resist merging similar orchestrator output handling and verdict parsing logic until at least three distinct modes exist. Keeping these paths separate during early feature development prevents premature coupling of specialized modes that might later diverge in requirements.

## Lesson — Setting open-pull-requests-limit to 0 in dependabot.yml…

**Tags:** dependabot, security, configuration

Setting open-pull-requests-limit to 0 in dependabot.yml suppresses routine version bumps while still allowing critical security patches to trigger PRs via GitHub's repo-level security settings. This distinction allows for a security-only automated update policy that prevents noise and maintenance fatigue.

## Lesson — Performing content.split('\n') inside a loop over line…

**Tags:** performance, nodejs, security

Performing `content.split('\n')` inside a loop over line numbers creates quadratic $O(N \times M)$ complexity. Hoisting the split ensures linear performance and prevents potential Denial of Service (DoS) when processing large files.

## Lesson — Synchronous file operations are often preferable in CLI…

**Tags:** nodejs, architecture, performance

Synchronous file operations are often preferable in CLI tools for simplicity, as blocking the event loop is not a concern for short-lived, single-user processes. This differs from server-side environments where async I/O is mandatory to maintain responsiveness.

## Lesson — Diff parsing state machines must track hunk status to…

**Tags:** parsing, git, state-machine

Diff parsing state machines must track hunk status to prevent embedded `+++` or `---` markers (e.g., in test fixtures or template literals) from being misread as file headers. Without this tracking, embedded diff content can prematurely terminate file context and corrupt rule application.

## Lesson — Local git metadata like branch names, commit messages, and…

**Tags:** security, git, terminal-injection

Local git metadata like branch names, commit messages, and diff stats can contain malicious ANSI escape sequences. Sanitize these strings before printing them to the terminal to prevent terminal injection attacks when running commands in untrusted repositories.

## Lesson — Lite versions of commands should prioritize concise…

**Tags:** design-decision, ux

Lite versions of commands should prioritize concise metadata, such as line counts, over full content dumps to remain fast and deterministic. This maintains a clear functional distinction between a high-level status snapshot and a context-heavy LLM operation.

## Lesson — When resolving file paths extracted from untrusted sources…

**Tags:** security, filesystem, path-traversal

When resolving file paths extracted from untrusted sources like git diffs, explicitly verify that the resolved path resides within the project root. This prevents directory traversal attacks where malicious input could force the tool to access files outside the intended repository boundary.

## Lesson — Warning messages triggered by security violations must…

**Tags:** security, error-handling, terminal-injection

Warning messages triggered by security violations must sanitize the offending input before display. Printing a raw malicious string (like a filename containing escape sequences) within a warning can inadvertently execute the very attack the system is alerting the user about.

## Lesson — Implement provider-specific libraries as optional peer…

**Tags:** architecture, performance, dependencies

Implement provider-specific libraries as optional peer dependencies and load them lazily at runtime to keep the core package size small. This "Bring Your Own Software Driver" pattern prevents users from being forced to install every supported SDK for providers they do not use.

## Lesson — Provide a dummy fallback API key (e.g., 'local-only') when…

**Tags:** openai, orchestrator, local-llm

Provide a dummy fallback API key (e.g., 'local-only') when targeting OpenAI-compatible local endpoints to bypass client-side SDK validation. Many local servers like Ollama do not require authentication, but official client SDKs often throw validation errors if the key field is left empty.

## Lesson — Treat usage and token statistics as optional fields when…

**Tags:** openai, defensive-programming, api-design

Treat usage and token statistics as optional fields when implementing OpenAI-compatible orchestrators. Third-party implementations often omit usage metadata that is guaranteed by the official OpenAI API, which can lead to runtime crashes during result processing if not handled defensively.

## Lesson — Wrap user-controlled fields like PR descriptions or…

**Tags:** security, prompting, llm

Wrap user-controlled fields like PR descriptions or comments in XML tags explicitly labeled as "untrusted content" within system prompts. This provides a defense-in-depth layer that helps the LLM distinguish between developer instructions and potentially malicious external data.

## Lesson — Sanitize git-sourced metadata like branch names, status,…

**Tags:** git, sanitization, security

Sanitize git-sourced metadata like branch names, status, and diff statistics to remove ANSI escape sequences and control characters. This prevents formatting corruption and parsing errors when passing terminal-sourced data to downstream tools or LLM contexts.

## Lesson — Ollama num_ctx and VRAM: The OpenAI-compatible API adapter…

**Tags:** ollama, orchestrator, vram, num_ctx, performance, hardware

Ollama `num_ctx` and VRAM: The OpenAI-compatible API adapter does not support passing `num_ctx` to Ollama, so context length defaults to the model's built-in default (often 2-8k). Ollama's native `/api/chat` endpoint accepts `options: { num_ctx }` for dynamic context sizing. On consumer GPUs (16GB VRAM), a 27B model fills VRAM with weights alone — any KV cache beyond ~8k spills to system RAM and significantly slows inference. Different Totem commands have different context needs (triage: 4-8k, shield/spec: 16-32k), making dynamic `num_ctx` sizing valuable. See issue #298.

## Lesson — When scanning for malicious payloads like Base64 or Unicode…

**Tags:** security, prompt-injection, validation

When scanning for malicious payloads like Base64 or Unicode escapes, ensure checks cover all user-controllable fields, including headings or metadata. Neglecting these fields allows attackers to bypass security heuristics by smuggling payloads in smaller, less-scrutinized buffers.

## Lesson — Leakage detection regex must be explicitly synchronized…

**Tags:** security, regex, prompt-engineering

Leakage detection regex must be explicitly synchronized with the exact XML tags used to wrap untrusted content in the prompt. Missing specific delimiters like `comment_body` or `diff_hunk` in the detection logic creates blind spots where internal prompt structures can leak without being flagged.

## Lesson — While interactive users can be trusted to review and…

**Tags:** ci, security, automation

While interactive users can be trusted to review and override heuristic flags, automated CI pipelines should treat these flags as hard failures with non-zero exit codes. This prevents the silent ingestion of potentially malicious or malformed data when human oversight is absent.

## Lesson — Heuristic regexes designed to detect structural leakage…

**Tags:** security, regex, prompt-injection

Heuristic regexes designed to detect structural leakage must include every XML tag used to wrap untrusted content in the prompt. Omitting tags like comment_body or diff_hunk allows attackers to leak prompt metadata without triggering the validator.

## Lesson — Security heuristics like Base64 or Unicode escape detection…

**Tags:** security, heuristics, prompt-injection

Security heuristics like Base64 or Unicode escape detection must scan both headings and bodies rather than just the primary content field. Even restricted fields like 60-character titles provide enough space for malicious payloads to bypass selective scanning.

## Lesson — Command-line tools using auto-accept flags like --yes…

**Tags:** ci, security, automation

Command-line tools using auto-accept flags like --yes should exit with a non-zero code if heuristic validators flag suspicious content. This prevents automated pipelines from silently ingesting poisoned or low-quality data that would otherwise require human intervention.

## Lesson — Heuristic validators designed to detect tag leakage must…

**Tags:** security, regex, prompt-engineering

Heuristic validators designed to detect tag leakage must explicitly include every XML tag used in the system prompts (e.g., `diff_hunk`, `comment_body`). Failing to mirror the exact set of delimiters creates blind spots that attackers can exploit to break out of the intended LLM context.

## Lesson — Heuristic checks for malicious patterns like Base64 blobs…

**Tags:** security, validation, prompt-injection

Heuristic checks for malicious patterns like Base64 blobs or Unicode escapes must be applied to all fields influenced by the LLM (like headings), not just the primary text body. Metadata fields often have enough character capacity to smuggle payloads that bypass detection logic focused only on the main content.

## Lesson — Casting an object literal to an Error type does not satisfy…

**Tags:** typescript, error-handling, trap

Casting an object literal to an Error type does not satisfy `instanceof Error` checks because the prototype chain is missing at runtime. Use `Object.assign(new Error(message), properties)` to ensure objects pass both TypeScript validation and runtime prototype inspections.

## Lesson — Avoid using Zod's .url() validator for configurations where…

**Tags:** zod, validation, dx, ollama

Avoid using Zod's `.url()` validator for configurations where users frequently provide bare hostnames or `host:port` without protocols. Strict URL validation requires a protocol prefix (e.g., `http://`), which can break the developer experience for common local service configurations like Ollama.

## Lesson — For local LLM providers, 500 Internal Server Errors often…

**Tags:** error-handling, ollama, ux

For local LLM providers, 500 Internal Server Errors often indicate VRAM or context exhaustion rather than generic software bugs. Providing specific guidance to adjust hardware-steering parameters like `numCtx` in the error message helps users resolve resource-constrained failures immediately.

## Lesson — Wrap untrusted content like code diffs in XML delimiters…

**Tags:** security, prompting, llm

Wrap untrusted content like code diffs in XML delimiters and provide explicit security instructions in the system prompt. This prevents prompt injection where malicious comments within the diff could hijack the LLM's instructions.

## Lesson — Sanitize LLM-generated content before persisting it to…

**Tags:** security, sanitization, persistence

Sanitize LLM-generated content before persisting it to version-controlled files if the source material is untrusted. This creates a security boundary that prevents persisting malicious payloads, such as ANSI escape sequences, which could trigger terminal injection when developers view the files.

## Lesson — Prefer auto-generating headings at the storage layer rather…

**Tags:** architecture, consistency, automation

Prefer auto-generating headings at the storage layer rather than persisting LLM-provided headings when multiple extraction paths exist. This ensures the knowledge base maintains a uniform format regardless of whether lessons are extracted via manual commands or automated review passes.

## Lesson — Avoid using exit 0 inside git hooks intended for chaining

**Tags:** git, shell, automation

Avoid using `exit 0` inside git hooks intended for chaining, as it terminates the entire shell process and prevents subsequent appended hooks from executing. Wrapping logic in `if/fi` blocks ensures the hook script can continue to other contributors' logic.

## Lesson — Perform shell-level existence checks before invoking CLI tools

**Tags:** performance, git, shell

Perform shell-level existence checks (e.g., `if [ -f config.json ]`) in git hooks before invoking heavy CLI tools. This prevents the performance overhead of starting a Node.js runtime in environments where the tool is not configured or required.

## Lesson — Detect existing hook managers and provide manual guidance

**Tags:** git, dx, automation

Detect existing hook managers like Husky or Lefthook and provide manual integration guidance instead of writing directly to `.git/hooks`. This avoids clobbering developer workflows and prevents configuration conflicts between multiple management tools.

## Lesson — Validate that an existing git hook is a shell script before appending

**Tags:** git, safety, automation

Validate that an existing git hook is a shell script (e.g., by checking for a shebang) before attempting to append automated logic. This prevents the corruption of binary or specialized hooks that cannot handle string-based appends.

## Lesson — Automated review tools often have stale knowledge of the

**Tags:** llm, testing, integration

Automated review tools often have stale knowledge of the latest or experimental model identifiers (e.g., `gemini-2.5-flash`). Prioritize model IDs proven to work in existing smoke tests over AI suggestions that flag them as typos.

## Lesson — Avoid adding explicit runtime guards for conditions that

**Tags:** typescript, refactoring

Avoid adding explicit runtime guards for conditions that are already prohibited by strict TypeScript interfaces. Redundant checks for "cannot happen" states like `undefined` on a required property add clutter without improving safety when the design contract is already enforced.

## Lesson — During data ingestion, strip high-risk security threats

**Tags:** security, ingestion

During data ingestion, strip high-risk security threats like BiDi overrides (Trojan Source) but only flag patterns like XML tags or Base64 via warnings. This prevents malicious injection while preserving the integrity of legitimate content that happens to use those formats.

## Lesson — When detecting project environments, use a consistent

**Tags:** bun, nodejs, devops

When detecting project environments, use a consistent priority order (e.g., pnpm > yarn > bun > npx) to ensure specific lockfiles are honored. This includes checking for both legacy (`bun.lockb`) and modern (`bun.lock`) versions to maintain compatibility across tool versions.

## Lesson — Implement an adversarial evaluation harness with planted

**Tags:** testing, llm, quality-assurance

Implement an adversarial evaluation harness with planted architectural violations to monitor LLM performance over time. Combining deterministic regex-based tests with gated LLM integration tests ensures that model drift is caught when reasoning fails to identify known traps.

## Lesson — Moving security-sensitive regexes (like BiDi stripping or…

**Tags:** security, regex, refactoring

Moving security-sensitive regexes (like BiDi stripping or XML bypass defense) from CLI tools to core packages ensures consistent adversarial scrubbing across both ingestion pipelines and runtime shields. Hardening these patterns against whitespace bypasses (e.g., optional whitespace after closing slash in tags) prevents common prompt injection evasion techniques.

## Lesson — Automated code reviewers often flag bleeding-edge model

**Tags:** llm, testing, integration

Automated code reviewers often flag bleeding-edge model identifiers (like `gemini-2.5-flash`) as typos due to stale training data. Always prioritize the project's verified configuration or official provider documentation over AI-suggested "corrections" to model names.

## Lesson — Do not add runtime undefined guards for properties

**Tags:** typescript, refactoring

Do not add runtime `undefined` guards for properties explicitly typed as non-optional (e.g., `string` vs `string | undefined`) in the shared interface. Trusting the established type contract reduces code noise and prevents redundant defensive logic.

## Lesson — When detecting Bun environments, check for both bun.lockb

**Tags:** bun, devops, nodejs

When detecting Bun environments, check for both `bun.lockb` (legacy) and `bun.lock` (Bun >= 1.2) to ensure compatibility. Priority for package manager detection should be explicitly defined (e.g., pnpm > yarn > bun > npx) to handle hybrid environments.

## Lesson — Ensure model name validation regexes explicitly allow

**Tags:** validation, regex, llm-providers

Ensure model name validation regexes explicitly allow character delimiters like dots to accommodate newer naming schemes such as `gpt-5.4`. This prevents runtime failures or schema validation errors when migrating to next-generation identifiers from external providers.

## Lesson — Audit initialization files and configuration schemas during

**Tags:** architecture, configuration, auditing

Audit initialization files and configuration schemas during model updates to ensure that secondary provider IDs do not leak into logic reserved for the primary orchestrator. This practice preserves architectural boundaries and keeps the core system decoupled from specific external vendor versions.

## Lesson — Use pnpm exec for workspace binaries in monorepos

**Tags:** pnpm, monorepo, turborepo, automation

Use `pnpm exec` instead of `pnpm bin` when checking for or executing binaries that might be internal workspace packages. In Turborepo environments, `pnpm exec` reliably handles workspace package resolution whereas `pnpm bin` often fails to locate binaries that aren't installed as standard root dependencies.

## Lesson — Static hook installer bootstraps before CLI is built

**Tags:** git-hooks, dev-experience, bootstrapping

Implement a lightweight static installer to manage git hooks during initial project setup before the primary CLI is built. Using consistent markers across both static scripts and the dynamic CLI allows for unified validation and prevents the "chicken and egg" dependency on the tool itself.

## Lesson — Non-interactive --check flag enables CI hook enforcement

**Tags:** git-hooks, ci, automation

Expose a non-interactive `--check` flag in hook management commands that scans for specific markers and exits with a non-zero code if they are missing. This allows CI pipelines to enforce hook adoption and ensure developers haven't bypassed local quality gates.

## Lesson — Verify CLI availability in shared git hooks before execution

**Tags:** git-hooks, ci, shell-scripting

Verify CLI availability in shared git hooks (e.g., using `command --version`) before execution to prevent brittle CI failures. This is critical in environments where dev-only tools might be missing or purged during specific lifecycle phases like release workflows.

## Lesson — CLI entrypoints print clean errors, libraries throw

**Tags:** error-handling, cli, ux

Top-level CLI handlers should use guards or catch blocks to print clean, user-friendly messages and exit gracefully instead of throwing errors. Throwing should be reserved for internal library functions where callers must handle specific failure states programmatically.

## Lesson — Resolve git root via rev-parse for monorepo compatibility

**Tags:** git, monorepo, nodejs

Always resolve the git repository root via "git rev-parse --show-toplevel" instead of checking for a .git directory in the current path. This ensures tools work correctly inside monorepo sub-packages, submodules, and git worktrees.

## Lesson — Windows requires shell:true for git binary resolution

**Tags:** windows, security, git

Using "shell: true" in execFileSync is often required on Windows to resolve the git binary correctly across different environments. While this presents a theoretical binary hijacking risk, the pattern is often acceptable if the threat model already assumes an attacker with local file system access.
