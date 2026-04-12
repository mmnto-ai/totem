# Trap Ledger & Self-Healing Rules

Architectural enforcement is the floor. Totem's real advantage is **telemetry-driven adaptation** on top of that floor.

If a compiled rule is too strict or hallucinates false positives, it will cause developer friction. Instead of forcing developers to manually edit configuration files or blindly bypass the system, Totem uses developer friction as data to automatically heal itself.

## 1. The Trap Ledger

The Trap Ledger is an immutable, append-only event stream located at `.totem/ledger/events.ndjson`. It operates locally on your machine and tracks how the deterministic enforcement layer is interacting with your codebase.

### What gets recorded?

The Ledger actively monitors your usage of Totem override directives:

- `// totem-ignore` (Hard suppression)
- `// totem-context:` (Semantic suppression)
- `// shield-context:` (Deprecated alias, emits warning as of 1.6.0)

Whenever `totem lint` or `totem review` encounters one of these directives, it logs an `override` event to the ledger.

### Event Schema

The NDJSON records contain high-fidelity context about the friction event:

```json
{
  "timestamp": "2026-03-25T14:32:00.000Z",
  "type": "exception",
  "ruleId": "no-console-in-core",
  "file": "packages/core/src/logger.ts",
  "line": 42,
  "justification": "This is the logger module, console is required here.",
  "source": "totem-context"
}
```

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
