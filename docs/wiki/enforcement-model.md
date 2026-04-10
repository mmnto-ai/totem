# Enforcement Model

Your AI doesn't have to be obedient. It just has to push code.

## A Platform of Primitives

Totem provides the **primitives** — the knowledge index, the compiler, the compiled AST rules, the lint results, and the review verdicts. These are the building blocks that measure and report the state of your codebase.

Totem does **not** force a specific workflow — it doesn't dictate when to block, inject, or enforce. You decide how to wire these primitives into your own Git hooks, CI config, or IDE plugins. Totem ships reference wiring, not a mandatory policy.

| Layer             | What Totem Provides                     | Where You Wire It            |
| ----------------- | --------------------------------------- | ---------------------------- |
| **Deterministic** | `totem lint` (compiled rules, zero LLM) | Git pre-push hook            |
| **Knowledge**     | `search_knowledge` (vector index)       | SessionStart hook, MCP tools |
| **Review**        | `totem review` (LLM-powered analysis)   | PreToolUse hook (optional)   |

### The Git Hook (Product — All Users)

The pre-push hook runs two stateless checks:

1. `totem verify-manifest` — ensures compiled rules match lesson source
2. `totem lint` — deterministic rule enforcement, zero LLM

No flag files. No LLM calls. No workflow opinions. Works air-gapped.

### The PreToolUse Hook (Reference Implementation — Opt-In)

For teams using AI agents, Totem provides a reference `PreToolUse` hook that uses **content hashing** to verify the agent reviewed the code before pushing. This is actor-aware — it only fires for the AI agent, never for the human developer.

This is a reference implementation. You can use it as-is, adapt it, or build your own enforcement using Totem's primitives.

## Handling False Positives

Sometimes, breaking an architectural rule is the correct technical decision. Use the Semantic Overlay:

```typescript
// totem-context: We are interacting with a legacy 3rd-party API that requires this mutable state.
globalThis.__legacyAPIState = {};
```

Every override is recorded in the local **Trap Ledger**. If a rule is overridden frequently, `totem doctor --pr` will automatically downgrade it to a warning. Totem learns from your context and steps out of your way.

## Unified Findings Model

Both `totem lint` and `totem review` produce findings in a common `TotemFinding` schema (ADR-071):

- `totem lint --format json` includes a `findings[]` array with normalized fields
- `totem-context:` is the single override directive for both lint and review
- PR comments and SARIF output consume the unified model

## Works Without AI

Totem's core enforcement is **100% deterministic** — no LLM, no API keys, no network.

| Feature                          | Requires AI? |
| -------------------------------- | :----------: |
| `totem lint` (compiled rules)    |      No      |
| `totem init` (baseline rules)    |      No      |
| Pre-push git hook                |      No      |
| AST classification (Tree-sitter) |      No      |
| `totem sync` (vector index)      |   Embedder   |
| `totem lesson compile`           |     LLM      |
| `totem review` (AI review)       |     LLM      |
| `totem spec` (planning)          |     LLM      |

The AI helps you **write** rules. The rules enforce themselves.
