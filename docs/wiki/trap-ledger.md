# Trap Ledger & Rule Tuning

Architectural enforcement is the floor. On top of that floor, Totem adapts rules from telemetry.

If a compiled rule is too strict or hallucinates false positives, it will cause developer friction. Instead of forcing developers to manually edit configuration files or blindly bypass the system, Totem records that friction as telemetry — and `totem doctor --pr` turns the telemetry into reviewable rule changes.

## 1. The Trap Ledger

The Trap Ledger is an immutable, append-only event stream located at `.totem/ledger/events.ndjson`. It operates locally on your machine and tracks how the deterministic enforcement layer is interacting with your codebase.

### What gets recorded?

The Ledger captures two semantic families of events.

**Override events** (one per directive encountered):

- `// totem-ignore` (Hard suppression) → `type: "suppress"`
- `// totem-context:` (Semantic suppression) → `type: "suppress"`
- `// shield-context:` (Deprecated alias, emits warning as of 1.6.0) → `type: "suppress"`
- `totem shield --override` → `type: "override"`
- Pattern exemptions → `type: "exemption"`

**Activity events** (one per agent interaction, A.3.a onwards):

- `mcp_call` — MCP tool invocation (e.g., `search_knowledge`); identified by `activity_name`. Emitted by the MCP server when a tool fires (`source: "bot"` now; MCP `agent_source` attribution deferred to A.3.c).
- `tool_call_first_significant` — first non-Read/Grep/Glob orchestrator tool call in the session. (Writer ships in A.3.b.)
- `hook_fire` — lifecycle hook executed (e.g., `SessionStart`, `PreToolUse`, `pre-push`). (Writer ships in A.4.a.)
- `session_start` — SessionStart hook fired; new `session_id` minted to `.totem/ledger/.session-id`. Emitted by the Claude SessionStart hook script scaffolded by `totem init` (Gemini writer deferred).

### Event Schema

The NDJSON records contain high-fidelity context about the friction event.

**Override event example:**

```json
{
  "timestamp": "2026-03-25T14:32:00.000Z",
  "type": "suppress",
  "ruleId": "no-console-in-core",
  "file": "packages/core/src/logger.ts",
  "line": 42,
  "justification": "This is the logger module, console is required here.",
  "source": "lint"
}
```

**Activity event example** (A.3.a onwards, ADR-029 compliance metric source):

```json
{
  "timestamp": "2026-05-15T03:00:00.000Z",
  "type": "mcp_call",
  "source": "bot",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "activity_name": "search_knowledge"
}
```

(MCP `agent_source` attribution lands in A.3.c via orchestrator → MCP correlation propagation; `session_start` events emitted by the Claude hook carry the env-derived seat from `TOTEM_SELF_AGENT` when it is set, and omit the field otherwise.)

The canonical schema (with field-level descriptions, optionality, and discriminator semantics) lives in `packages/core/src/ledger.ts` (`LedgerEventSchema`). Two orthogonal axes worth calling out:

- `source` — emitting subsystem (`lint` | `shield` | `bot`)
- `agent_source` — agent identity that produced the event: a cohort seat-id or `human` (e.g. `strategy-claude`, `lc-codex`, `human`), per ADR-078 § Event Attribution as amended 2026-07-15. A vendor class projects mechanically from a seat (`strategy-claude` → `claude`); the reverse projection does not exist. Legacy vendor-class values (`claude` | `gemini`) from pre-amendment writers remain parseable.

Per ADR-078 § Event Attribution: agent attribution lives in `agent_source`; `source` identifies which Totem subsystem fired the event. Pre-A.3.a events have no `agent_source` field and are forward-compatible (the field is optional).

### Query-before-derive events (mmnto-ai/totem#2510)

Two event types measure one thing: of the derive-class actions in an agent session, what fraction was preceded by a corpus query correlated to that action?

- `corpus_query` — a corpus query fired. Written by the `totem search` CLI path and the MCP `search_knowledge` tool. Mints a fresh `qbd_correlation_id`.
- `derive_action` — a derive-class action ran (`totem spec` synthesis, `totem orient` derivation, `totem review` grounding). Carries the `qbd_correlation_id` of the query that grounded it, or **no** ID when nothing did.

```json
{
  "timestamp": "2026-07-28T12:00:01.000Z",
  "type": "derive_action",
  "source": "lint",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "activity_name": "spec",
  "qbd_correlation_id": "qbd1-2h1s4kbqr-9f2c0a7e51d34b60"
}
```

`qbd_correlation_id` is distinct from `correlation_id` (ADR-014's orchestrator → MCP trace ID) and is **self-dating**: it encodes the instant it was minted, and `LedgerEventSchema` cross-checks that instant against the row's own `timestamp`. A query row whose ID was not minted at its own write instant, and a derive row citing an ID minted after the derive or older than the correlation window, both fail to parse. Minted-at-write-time is therefore a schema constraint, not a convention — a backfilled ID is a schema violation rather than a data point.

Semantics worth knowing before reading the number:

- **One query grounds ONE derive.** The correlation pointer is consumed on use, _and_ the scanner refuses to credit a second derive citing an already-spent ID. Both halves are needed: consumption is a write-time rule, and a write-time rule with no read-side check is unenforced the moment the consume fails, races, or is bypassed. Without it, one query credits every derive for the rest of the window — "queried at least once per two hours", not "queried before deriving".
- **Correlation window** — two hours. The value is borrowed from ADR-029 § 2 so the slice carries one time constant, but treating that span as a _grounding-validity_ window is this slice's own design decision; ADR-029 § 2 defines a session-grouping heuristic for the recall metric, a different question.
- **Correlation is scoped to one seat and one session, fail-closed.** Both sides must carry a session id and agree on it, and the seats must match. Cohort seats share one working tree per repo, so a pointer left by another seat is reachable. Two _unseated_ sides compare equal — the right default for a solo repo — but seating exactly one side (a seated CLI against an unseated MCP server) stops correlation entirely and produces a truthful-looking `0.00`. The render emits a seat-mismatch hint on that shape; seat plumbing itself is tracked in mmnto-ai/totem#2530.
- **The denominator is every derive-class event**, including those in sessions that fired zero queries. An uncorrelated derive is the observation the metric exists to make.
- **All review modes count** — the standard path, `--mode structural`, and the multi-lane fan. The rule in each case is that the review actually produced a verdict, expressed in that path's own terms: for the standard and structural paths, once a verdict has **parsed**; for the fan, the instant the **verdict artifact is persisted**. A **FAIL** verdict records, because a failing review is a completed derive and excluding it would shrink the denominator — and so does a fan round that persists an honest `settled=false` verdict and then hard-errors on its exit policy. Nothing records for `--raw` (a context dump with no verdict), for an unparsable verdict, or for a fan that throws before writing an artifact. This matches `spec`, which records only after synthesis produced content. Structural mode is context-blind and builds no grounding bundle, so "review grounding" is loose for it: what is counted is the agent-initiated review action.
- **Where rows land.** The CLI surfaces and the doctor reader resolve the ledger from the resolved **config root**, not the invocation cwd. `resolveConfigPath` does not walk up, so from a subdirectory with no local config the row lands in the global `~/.totem/` profile — announced in the output, never silently. The MCP server resolves its own project root independently, so a CLI derive run from a subdirectory and an MCP query can land in different ledgers.
- Session identity comes from the existing `.session-id` primitive, with a per-seat rolling-window fallback for hookless runs.
- **The SessionStart hook's `orient --session` render is not instrumented.** It is machine-initiated and fires before an agent could have queried anything; counting it would measure the hook's scheduling rather than an agent's adherence. No session is excluded by this, and no agent-initiated derive is dropped.
- **Adjacency, not influence.** A query fired to satisfy the metric whose results the following derive never reads is indistinguishable here from one that genuinely grounded it. Named, not solved.
- **Backdated appends are detected, whole-file rewrites are not.** The scanner degrades a read whose timestamps regress in an append-only file, measured against **every** row — a ledger whose history is entirely non-QBD still provides the baseline. An internally consistent rewrite of the entire file, or a file authored wholesale from empty, defeats it; nothing short of signing would not.
- **DEGRADED is sticky, and actionable.** One untrustworthy row degrades the whole read and neither the row nor the verdict expires, which is the honest posture for a file whose integrity is in question. So the envelope names the offending line numbers and says what to do: repair an append-only ledger by appending corrections, never by rewriting history.

Read it with `totem doctor --compliance`, which renders the rate, its trend, the pre-registered threshold and window, and — when the ledger scan hit rows it could not trust — an explicit `DEGRADED` / `UNVERIFIED` envelope with per-item counts. Nothing gates on the number (Tenet 13).

---

## 2. The Rule-Tuning Loop (`totem doctor --pr`)

The Trap Ledger provides the raw telemetry, but the **Doctor** provides the cure.

Running `totem doctor --pr` starts the tuning sequence: the command aggregates the local telemetry, calculates bypass rates for every compiled rule, and stages the resulting changes as a pull request for human review.

### The Algorithm

1.  **Thresholds:** The Doctor looks for rules that have been evaluated a minimum number of times (e.g., 5 events) and have a **Bypass Rate > 30%**.
2.  **Downgrade:** If a rule is bypassed that frequently, it is deemed mathematically noisy. The Doctor modifies `compiled-rules.json`, downgrading the rule's severity from `error` to `warning`, or archiving stale rules.
3.  **Upgrade:** The Doctor upgrades regex rules to ast-grep when context telemetry shows >20% of matches landing in non-code contexts. The `compileCommand({ upgradeBatch })` is invoked in-process from `runSelfHealing`.
4.  **Human Review:** Per **ADR-027 (Rule Lifecycle)**, Totem won't auto-delete rules or forcefully alter the architecture without human review. The Doctor creates a new git branch, commits the downgrade or upgrade, and opens a Pull Request with the exact numeric rationale in the body (e.g., _"Rule X has a 42% bypass rate"_).

### The Full Cycle

The full cycle — every change lands through a human-reviewed PR:

1. **Developer writes code.**
2. **`totem lint` catches a violation.**
3. **Developer overrides it** with `// totem-context: this is an edge case`.
4. **Trap Ledger records** the bypass event.
5. **`totem doctor --pr` sees** the rule is causing high friction.
6. **Totem opens a PR** gracefully downgrading the rule to a warning.
7. **Human reviews and merges** the PR.

Rules that work get stronger. Rules that don't get weaker. The system learns to stay out of your way.
