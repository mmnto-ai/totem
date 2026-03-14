# GitHub Copilot

GitHub Copilot is primarily an inline completion and chat assistant inside your editor or GitHub itself.

## 1. Config Surfaces

- **Project Context:** `.github/copilot-instructions.md` — The standard location for project-specific instructions for Copilot Chat.

## 2. Keeping Configs Lean

Because Copilot continuously injects these instructions into chat sessions, keeping `.github/copilot-instructions.md` highly focused on coding conventions and syntax helps maintain response quality.

## 3. Totem Integration

While Copilot does not have native MCP tool execution for commands like `search_knowledge`, you can include instructions in `.github/copilot-instructions.md` prompting the developer to check Totem manually or use editor integrations if supported.

## 4. Common Pitfalls

- **Length Constraints:** Overloading the instructions file dilutes Copilot's ability to provide accurate, context-aware completions.
