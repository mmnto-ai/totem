# GCA vs Gemini CLI Separation

When configuring the Totem repository, it is critical to understand that **Gemini Code Assist (GCA)** and the **Gemini CLI** are completely separate products with zero operational overlap, despite both utilizing the `.gemini/` configuration directory.

## 1. File-to-Product Mapping

| Product        | Environment        | Configuration Files                                                       | Purpose                                                                        |
| :------------- | :----------------- | :------------------------------------------------------------------------ | :----------------------------------------------------------------------------- |
| **GCA**        | Cloud / GitHub PRs | `.gemini/config.yaml`, `.gemini/styleguide.md`                            | Automated PR review, style enforcement, commenting on diffs.                   |
| **Gemini CLI** | Local Terminal     | `GEMINI.md`, `.gemini/settings.json`, `.gemini/hooks/`, `.gemini/skills/` | Local execution, broad file analysis, codebase editing, Totem MCP integration. |

## 2. The Danger of Overlap

A common mistake is assuming that instructions placed in `GEMINI.md` will be read by GCA, or that rules in `.gemini/styleguide.md` apply to the local CLI (they do not; the CLI relies on its own memory and `compiled-rules.json` for structural enforcement).

- **Command Hallucination:** If CLI instructions (like "Run `totem sync` after editing") leak into GCA's context, the headless GCA bot may hallucinate capabilities and attempt to run shell commands it does not possess.
- **Dead Files:** Developers sometimes create a lowercase `.gemini/gemini.md` file hoping to share context. This file is **dead**. It is unrecognized by both GCA and the Gemini CLI. The correct local instruction file is `GEMINI.md` (uppercase) at the root of the project.

## 3. How to Add GCA Decline Rules

When GCA repeatedly suggests an incorrect pattern during PR reviews (e.g., suggesting an async `execFile` when sequential execution is required), you must train it to decline that pattern.

1. **Update the Styleguide:** Add the specific declined pattern to Section 6 of `.gemini/styleguide.md`.
2. **Anchor the Lesson:** Use the Totem `add_lesson` reflex with the `review-guidance` tag on the same PR to ensure the architectural reasoning is stored in memory.

## 4. Case Sensitivity

The local Gemini CLI instruction file must be exactly `GEMINI.md`. While the CLI _can_ be configured to read a different file via `context.fileName` in settings, `GEMINI.md` is the standardized Totem default.

---

_For a broader overview of how all agents (Claude, Copilot, Junie) fit together, see the [Agent Memory Architecture](./agent-memory-architecture.md) guide._
