## How It Works — The 3-Layer Gate

Your AI doesn't have to be obedient. It just has to push code.

| Layer          | Mechanism                               | Purpose                                                                                                                              |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Suggestion** | `.cursorrules`, `CLAUDE.md`, `.gemini/` | Ask the AI to follow the rules so it works faster                                                                                    |
| **Fast Path**  | `verify_execution` MCP tool             | Let the AI grade its own homework before pushing                                                                                     |
| **Guarantee**  | `pre-push` git hook → `totem lint`      | Deterministic gate. If the AI ignored Layer 1 and skipped Layer 2, it hits the wall of Layer 3 and cannot proceed until it complies. |

Totem doesn't try to control the agent in real-time. It enforces a strict final output state — like a compiler, not a linter.

## Performance

`totem lint` runs **147 compiled rules in under 2 seconds** on a 7,400-line, 105-file PR. Zero LLM inference. Pure AST classification + regex matching.

| Metric         | Value                        |
| -------------- | ---------------------------- |
| Rules          | 147 (regex + AST + ast-grep) |
| Lines scanned  | 7,397                        |
| Files          | 105                          |
| Execution time | **1.75s**                    |
| LLM calls      | **0**                        |

This runs inside a `pre-push` git hook. Your AI agent's push is blocked until every violation is resolved — with the exact file, line, and fix guidance needed to self-correct in one cycle.
