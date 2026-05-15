---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-rust-architecture': minor
---

feat(core): Trap Ledger schema extension — agent attribution + activity events (A.3.a)

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

**Field relaxations:** `ruleId` and `file` are now optional at the schema level to accommodate activity events. Writer-side discipline enforces required-by-type for `suppress` / `override` / `exemption`. Promotion to a Zod `discriminatedUnion` is deferred to A.3.c per design doc OQ-1.

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

ADR-078 surface amendment (rename agent attribution from `source` to `agent_source` in § Decision 2) routed to strategy-Claude via substrate dispatch T0258Z. No code dependency in either direction.
