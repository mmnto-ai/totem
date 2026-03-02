# Totem Lessons

Lessons learned from PR reviews and Shield checks.
This file is version-controlled and reviewed in PR diffs.

---

## Lesson — 2026-02-28T22:42:43.291Z

**Tags:** embedding, ollama, openai, dogfood

When OpenAI embedding API returns 429, fall back to Ollama with nomic-embed-text for local development. The chunking pipeline is provider-agnostic — only the embedding step changes.

## Lesson — 2026-03-02T09:18:21.039Z

**Tags:** lancedb, schema, trap, dogfood

When the LanceDB schema defined in `@mmnto/totem` changes (e.g., renaming a column from `filepath` to `filePath`), running `totem sync` against an existing `.lancedb/` directory will crash with a Rust schema error from `lance-datafusion`. Because the index is treated as a disposable build artifact rather than a migratable database, the solution is to explicitly delete the `.lancedb/` folder (`rm -rf .lancedb`) and re-run the sync.

## Lesson — 2026-03-02T09:18:21.052Z

**Tags:** cli, windows, shell, trap

When executing external shell commands (like invoking the Gemini CLI orchestrator) on Windows, passing large prompts directly via string concatenation will fail with an 'argument list too long' error. You must write the prompt to a temporary file and pass the filepath. Crucially, the filepath placeholder in the shell command must be wrapped in quotes (e.g., `"{file}"`) to prevent crashes when the user's root directory contains spaces (e.g., `C:\Users\John Doe\`).

## Lesson — 2026-03-02T09:18:21.092Z

**Tags:** mcp, security, trap, gemini

When generating temporary files for an AI agent to read (such as orchestrator prompts), do NOT use the global OS temp directory (`os.tmpdir()`). Secure MCP clients (like the Gemini CLI) run with strict workspace boundary restrictions and will throw a 'Path not in workspace' error if asked to read a file outside the project root. Always write temporary agent files inside the project directory (e.g., `.totem/temp/`).
