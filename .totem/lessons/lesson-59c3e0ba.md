## Lesson — Apply regex shadowing rules only to known attack surfaces

**Tags:** security, regex, refactoring

Apply regex shadowing rules only to known attack surfaces like adapters and MCP code rather than entire codebases. Broad enforcement forces developers to replace simple regex matches with brittle string operations for non-sensitive parsing tasks.
