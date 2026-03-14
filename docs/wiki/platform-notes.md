# Platform Notes & Edge Cases

Totem works natively across Windows, macOS, and Linux. This document covers OS-specific quirks and workarounds.

## Windows

### The `npx` Subprocess Bug

On Windows, `npx` resolves to a `.cmd` script (`npx.cmd`). Many AI agents (like Claude Code or Cursor) attempt to spawn MCP servers as direct subprocesses and will fail with `ENOENT` if they try to execute a `.cmd` file directly.

**The Fix:**
In your MCP configuration files (`.mcp.json`, etc.), you must wrap the execution in the Windows command processor:

```json
{
  "mcpServers": {
    "totem": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@mmnto/mcp"]
    }
  }
}
```

_(Note: `totem init` handles this scaffolding automatically based on your OS)._

### Git Hooks & Terminals

Git hooks installed by Totem run via Git for Windows' bundled shell (MinGW/bash). They will execute transparently regardless of whether you triggered the `git commit` from PowerShell, CMD, Windows Terminal, or a GUI client.

### Path Separators

`totem.config.ts` uses **forward slashes** (`src/**/*.ts`) for glob patterns on all platforms. Do not use backslashes (`\`) in your config, even on Windows.

## macOS / Linux

### Case Sensitivity

Windows file systems are largely case-insensitive, while macOS and Linux are case-sensitive.

- Ensure your Gemini CLI instruction file is exactly `GEMINI.md` (uppercase). If you create `gemini.md` locally on a Mac, the CLI will silently ignore it.

### Executable Permissions

If you encounter permission denied errors on git hooks after checking out a repository on macOS/Linux, ensure the hook files are executable:

```bash
chmod +x .git/hooks/pre-push
```

### Ollama Setup

If using Ollama for embeddings or local orchestration (Air-Gapped Doctrine), you must ensure the daemon is running before executing `totem` commands.

- Run `ollama serve` in a background terminal.
- **macOS:** Install via Homebrew: `brew install ollama`.
- **Linux:** Follow the official installation guide or use the standard install script: `curl -fsSL https://ollama.com/install.sh | sh`.
