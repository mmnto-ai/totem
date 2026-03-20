## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** security, curated
**Pattern:** \b(echo|run_shell_command|exec|sh|bash)\b.*\$TOOL_INPUT
**Engine:** regex
**Scope:** *.sh, _.bash, _.yml, \*.yaml
**Severity:** error

MCP tool returns must be wrapped in XML tags (use formatXmlResponse) to prevent Indirect Prompt Injection from untrusted content.
