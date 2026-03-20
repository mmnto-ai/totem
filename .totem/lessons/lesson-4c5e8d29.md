## Lesson — When wrapping external errors or providing fallbacks,

**Tags:** architecture, curated
**Pattern:** \bnew\s+(?!Totem)Error\(
**Engine:** regex
**Scope:** **/\*.ts, **/_.tsx, \*\*/_.js, **/\*.jsx
**Severity:\*\*\*\* warning

Use TotemError (or a subclass like TotemParseError, TotemConfigError) instead of raw Error() for user-facing errors. The TotemError hierarchy provides structured error codes and recovery hints.
