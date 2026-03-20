## Lesson — Avoid inlining tokens or API keys in configuration files

**Tags:** security, curated
**Pattern:** "(?:api[_-]?key|token|secret|password)"\s*:\s*".+"
**Engine:** regex
**Scope:** **/\*.mcp.json, **/settings.json, **/.vscode/settings.json
**Severity:\*\*\*\* error

Avoid inlining tokens or API keys in configuration files. Use environment variables instead to ensure credentials are not committed to version control.
