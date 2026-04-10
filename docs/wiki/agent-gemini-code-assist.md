# Gemini Code Assist (GCA)

Gemini Code Assist operates headlessly to review Pull Requests and flag issues. It does not execute local terminal commands.

## 1. Config Surfaces

- **Project Settings:** `.gemini/config.yaml` — Configures PR review settings, severity thresholds, exclusions, and custom rules.
- **Style Rules:** `.gemini/styleguide.md` — Detailed syntactic rules, formatting, and coding standards used for PR reviews.

**Note:** GCA has _zero overlap_ with the local Gemini CLI instruction file (`GEMINI.md`), even though both tools use the `.gemini/` directory.

## 2. Keeping Configs Lean

GCA's `.gemini/config.yaml` can be as large as necessary since it acts as a configuration manifest rather than a prompt prefix. However, `.gemini/styleguide.md` should be focused strictly on rules that the PR reviewer can enforce.

## 3. Totem Integration

Totem influences GCA primarily through compiled architectural rules exported during `totem wrap` or `totem review`, which can inform the `.gemini/styleguide.md`. GCA does not use the `search_knowledge` MCP tool, as it cannot run local MCP servers.

## 4. Common Pitfalls

- **File Confusion:** Developers mistakenly placing `gemini.md` (lowercase) inside `.gemini/` expecting GCA to read it.
- **Command Hallucination:** If CLI commands (like `totem sync`) leak into GCA's context, the bot may hallucinate capabilities it doesn't have.

## 5. How to Add GCA Decline Rules

When GCA repeatedly suggests an incorrect pattern during PR reviews (e.g., suggesting an async `execFile` when sequential execution is required), you must train it to decline that pattern.

1. **Update the Styleguide:** Add the specific declined pattern to Section 6 of `.gemini/styleguide.md`.
2. **Record the Lesson:** Use the Totem `add_lesson` tool with the `review-guidance` tag on the same PR to ensure the architectural reasoning is stored in the knowledge base.
