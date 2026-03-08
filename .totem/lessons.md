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

When scaffolding agent hooks (like Claude's PreToolUse) or background git hooks, avoid embedding complex shell pipelines (e.g., grep chains, escaping quotes) directly inline within JSON configuration files. It is fragile and hard to test. Long-term architectural rule: Extract hook logic into dedicated, version-controlled executable scripts (e.g., \`.totem/hooks/shield-gate.js\` or \`.gemini/hooks/BeforeTool.js\`) and have the JSON config simply invoke the script.

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

When scaffolding configuration files that store settings in JSON arrays (like `.claude/settings.local.json`), implement deep merging to append entries rather than overwriting the entire key. This allows the tool to maintain idempotency while preserving existing user-defined hooks.

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
