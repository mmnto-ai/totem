## Lesson — Use a case-insensitive regex with optional internal

**Tags:** security, regex, llm

Use a case-insensitive regex with optional internal whitespace (e.g., /<\/\s*tag\s*>/i) when matching closing tags. Rigid literal matches are easily bypassed by LLMs or parsers, leading to prompt injection vulnerabilities.
