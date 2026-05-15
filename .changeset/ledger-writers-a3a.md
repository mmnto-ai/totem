---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-rust-architecture': minor
---

feat(mcp+cli): Trap Ledger activity writers — MCP `mcp_call` + SessionStart `session_start` (A.3.a writers)

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
- `writeSessionId(totemDir, sessionId)` — persists to `.totem/ledger/.session-id`. Fire-and-forget on I/O failure.
- `readSessionId(totemDir, ttlHours?)` — reads + validates UUID shape + checks mtime against TTL (default 24h). Returns `undefined` for missing/expired/malformed files.

## Tests

- `packages/core/src/session-id.test.ts` — 10 tests covering mint uniqueness, write/read round-trip, malformed UUID rejection, TTL expiration (file backdating via `utimesSync`), custom TTL argument, trailing-whitespace tolerance.
- `packages/mcp/src/ledger-writer.test.ts` — 5 tests covering event emission, session_id population/omission, getContext failure (must not throw), append-don't-overwrite.
- `packages/mcp/src/tools/search-knowledge.test.ts` — 2 new integration tests verifying handler emits `mcp_call` with `activity_name: 'search_knowledge'`, including the dimension-mismatch error path (invocation, not success, is what ADR-029 measures).
- `packages/cli/src/commands/init.test.ts` — 4 new tests covering the SessionStart template's session-id minting, persistence, ledger-event emission, and fire-and-forget error-handling.

## Backward compatibility

Same forward-only story as A.3.a schema:

- Pre-writers Trap Ledgers don't contain `mcp_call` or `session_start` events — readers parse them fine when they appear post-upgrade.
- SessionStart hook ledger-write block is in its own try/catch; if it fails (read-only filesystem, missing perms, etc.), the briefing path still runs.

## ADR alignment

- ADR-029 § Session Heuristic: explicit UUID supersedes the rolling-2h activity heuristic when `.session-id` is present.
- ADR-078 § Event Attribution: `source: 'bot'` for both writers (emitter = MCP server / hook subsystem). `agent_source` left undefined; A.3.c populates it via orchestrator → MCP correlation propagation.
- ADR-077 Smart Briefing: SessionStart hook already shipped (`installClaudeHooks` scaffolds the script); this PR only extends its body.

## Out of scope (next sub-lifts)

- **A.3.b** — `totem doctor --compliance` reads these events and computes the ADR-029 metric (~1 week).
- **A.3.c** — orchestrator → MCP correlation_id propagation; populates `agent_source` (~1 week).
- **A.4.a / A.4.b** — PreToolUse soft-block + pre-push hard-block (per C-12); reads `mcp_call` events to gate Write/Edit on `proposals/active/**`, `adr/**`, `research/**`.
- **Gemini SessionStart writer** — symmetric pattern, deferred for parity sweep.
- **Other MCP tools** (`describe_project`, `add_lesson`, `verify_execution`) — wire `logMcpCall` when needed for broader observability.
