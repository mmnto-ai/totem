# Enforcement Model

Your AI doesn't have to be obedient. It just has to push code.

## The 3-Layer Gate

| Layer          | Mechanism                               | Purpose                                                                                                                              |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Suggestion** | `.cursorrules`, `CLAUDE.md`, `.gemini/` | Ask the AI to follow the rules so it works faster                                                                                    |
| **Fast Path**  | `verify_execution` MCP tool             | Let the AI grade its own homework before pushing                                                                                     |
| **Ensure**     | `pre-push` git hook → `totem lint`      | Deterministic gate. If the AI ignored Layer 1 and skipped Layer 2, it hits the wall of Layer 3 and cannot proceed until it complies. |

Totem doesn't try to control the agent in real-time. It enforces a strict final output state — like a compiler, not a linter.

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
