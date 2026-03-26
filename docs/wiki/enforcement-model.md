# Enforcement Model

Your AI doesn't have to be obedient. It just has to push code.

## The 3-Layer Gate

| Layer          | Mechanism                               | Purpose                                                                                                                              |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Suggestion** | `.cursorrules`, `CLAUDE.md`, `.gemini/` | Ask the AI to follow the rules so it works faster                                                                                    |
| **Fast Path**  | `verify_execution` MCP tool             | Let the AI grade its own homework before pushing                                                                                     |
| **Ensure**     | `pre-push` git hook → `totem lint`      | Deterministic gate. If the AI ignored Layer 1 and skipped Layer 2, it hits the wall of Layer 3 and cannot proceed until it complies. |

Totem doesn't try to control the agent in real-time. It enforces a strict final output state — like a compiler, not a linter.

## Handling False Positives

Sometimes, breaking an architectural rule is the correct technical decision. To support edge cases without degrading your codebase's immune system, use the Semantic Overlay.

Instead of a naked `// totem-ignore`, provide your reasoning:

```typescript
// totem-context: We are interacting with a legacy 3rd-party API that requires this mutable state.
globalThis.__legacyAPIState = {};
```

This functions as a local exception, allowing your code to pass the `totem lint` deterministic gate.

Crucially, **every override is recorded as telemetry in the local Trap Ledger.** If a rule generates too much developer friction (e.g., it is overridden frequently), running `totem doctor --pr` will recognize the high bypass rate and automatically generate a Pull Request to downgrade the noisy rule to a warning.

This creates a **Self-Healing Loop**: Totem learns from your context and automatically steps out of your way.

## Unified Findings Model

Starting with 1.5.6, both `totem lint` and `totem shield` produce findings in a common `TotemFinding` schema (ADR-071). This means:

- **`totem lint --format json`** includes a `findings[]` array with normalized `id`, `source`, `severity`, `message`, `file`, `line`, and `confidence` fields.
- **`totem-context:`** is the single override directive for both lint and shield. The legacy `shield-context:` alias still works silently.
- **PR comments and SARIF output** consume the unified model, ensuring consistent reporting regardless of source.

## Works Without AI

Totem's enforcement layer is **100% deterministic** — no LLM, no API keys, no network required.

| Feature                          |  Requires AI?  |
| -------------------------------- | :------------: |
| `totem lint` (compiled rules)    |       No       |
| `totem init` (baseline rules)    |       No       |
| Pre-push git hook                |       No       |
| AST classification (Tree-sitter) |       No       |
| `totem sync` (vector index)      | Yes (embedder) |
| `totem compile` (rule authoring) |   Yes (LLM)    |
| `totem shield` (AI review)       |   Yes (LLM)    |
| `totem spec` (planning)          |   Yes (LLM)    |

The AI helps you **write** rules. The rules enforce themselves.
