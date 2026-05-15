# Trap Ledger & Self-Healing Rules

Architectural enforcement is the floor. Totem's real advantage is **telemetry-driven adaptation** on top of that floor.

If a compiled rule is too strict or hallucinates false positives, it will cause developer friction. Instead of forcing developers to manually edit configuration files or blindly bypass the system, Totem uses developer friction as data to automatically heal itself.

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
  "agent_source": "claude",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "activity_name": "search_knowledge"
}
```

The canonical schema (with field-level descriptions, optionality, and discriminator semantics) lives in `packages/core/src/ledger.ts` (`LedgerEventSchema`). Two orthogonal axes worth calling out:

- `source` — emitting subsystem (`lint` | `shield` | `bot`)
- `agent_source` — agent runtime that produced the event (`claude` | `gemini` | `human`)

Per ADR-078 § Event Attribution: agent attribution lives in `agent_source`; `source` identifies which Totem subsystem fired the event. Pre-A.3.a events have no `agent_source` field and are forward-compatible (the field is optional).

---

## 2. The Self-Healing Loop (`totem doctor --pr`)

The Trap Ledger provides the raw telemetry, but the **Doctor** provides the cure.

By running `totem doctor --pr`, you initiate the self-healing sequence. The command aggregates the local telemetry, calculates bypass rates for every compiled rule, and takes autonomous action.

### The Algorithm

1.  **Thresholds:** The Doctor looks for rules that have been evaluated a minimum number of times (e.g., 5 events) and have a **Bypass Rate > 30%**.
2.  **Downgrade:** If a rule is bypassed that frequently, it is deemed mathematically noisy. The Doctor modifies `compiled-rules.json`, downgrading the rule's severity from `error` to `warning`, or archiving stale rules.
3.  **Upgrade:** The Doctor upgrades regex rules to ast-grep when context telemetry shows >20% of matches landing in non-code contexts. The `compileCommand({ upgrade })` is invoked in-process from `runSelfHealing`.
4.  **Human Review:** Per **ADR-027 (Rule Lifecycle)**, Totem won't auto-delete rules or forcefully alter the architecture without human review. The Doctor creates a new git branch, commits the downgrade or upgrade, and opens a Pull Request with the exact numeric rationale in the body (e.g., _"Rule X has a 42% bypass rate"_).

### The Full Cycle

This creates an autonomous, self-regulating ecosystem:

1. **Developer writes code.**
2. **`totem lint` catches a violation.**
3. **Developer overrides it** with `// totem-context: this is an edge case`.
4. **Trap Ledger records** the bypass event.
5. **`totem doctor --pr` sees** the rule is causing high friction.
6. **Totem opens a PR** gracefully downgrading the rule to a warning.
7. **Human reviews and merges** the PR.

Rules that work get stronger. Rules that don't get weaker. The system learns to stay out of your way.
