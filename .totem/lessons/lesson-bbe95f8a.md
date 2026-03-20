## Lesson — Avoid using Zod's .url() validator for configurations where

**Tags:** architecture, curated
**Pattern:** \.url\(\)
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx
**Severity:\*\* error

Avoid Zod's .url() validator as it requires a protocol prefix (e.g., http://) and fails on bare hostnames or host:port configurations.
