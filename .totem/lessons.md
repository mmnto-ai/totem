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
