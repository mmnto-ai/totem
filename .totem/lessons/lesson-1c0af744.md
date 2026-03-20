## Lesson — Ollama num_ctx and VRAM: The OpenAI-compatible API adapter

**Tags:** architecture, curated
**Pattern:** 11434/v1
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.py, **/*.sh, .env*
**Severity:\*\* error

Ollama's OpenAI-compatible adapter (/v1) does not support 'num_ctx'. Use the native /api/chat endpoint with 'options: { num_ctx }' to enable dynamic context sizing and prevent VRAM overflow (issue #298).
