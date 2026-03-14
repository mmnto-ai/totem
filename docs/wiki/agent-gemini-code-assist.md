# Gemini Code Assist (GCA)

Gemini Code Assist operates headlessly to review Pull Requests and flag issues. It does not execute local terminal commands.

## 1. Config Surfaces

- **Project Settings:** `.gemini/config.yaml` — Configures PR review settings, severity thresholds, exclusions, and custom rules.
- **Style Rules:** `.gemini/styleguide.md` — Detailed syntactic rules, formatting, and coding standards used for PR reviews.

**Note:** GCA has *zero overlap* with the local Gemini CLI instruction file (`GEMINI.md`), even though both tools use the `.gemini/` directory.

## 2. Keeping Configs Lean

GCA's `.gemini/config.yaml` can be as large as necessary since it acts as a configuration manifest rather than a prompt prefix. However, `.gemini/styleguide.md` should be focused strictly on rules that the PR reviewer can enforce.

## 3. Totem Integration

Totem influences GCA primarily through compiled architectural rules exported during `totem wrap` or `totem shield`, which can inform the `.gemini/styleguide.md`. GCA does not use the `search_knowledge` MCP tool, as it cannot run local MCP servers.

## 4. Common Pitfalls

- **File Confusion:** Developers mistakenly placing `gemini.md` (lowercase) inside `.gemini/` expecting GCA to read it.
- **Command Hallucination:** If CLI commands (like `totem sync`) leak into GCA's context, the bot may hallucinate capabilities it doesn't have.
