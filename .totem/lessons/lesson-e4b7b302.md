## Lesson — NEVER inline secrets, tokens, or API keys into agent config

**Tags:** security, curated
**Pattern:** "(?:[Aa]pi[Kk]ey|[Aa]pi*?[Kk]ey|[Tt]oken|[Ss]ecret|[Pp]assword|[Aa]ccess*?[Tt]oken|[Pp]at)"\s*:\s*"[^"]+"
**Engine:** regex
**Scope:** **/\*.mcp.json, **/.gemini/settings.json, **/mcp-config.json, **/claude_desktop_config.json
**Severity:** error

NEVER inline secrets, tokens, or API keys into agent configs (.mcp.json, settings.json, etc.). Use environment variables instead.
