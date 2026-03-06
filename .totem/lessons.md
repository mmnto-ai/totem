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
