## Lesson — Persist masked prompts in artifacts

**Tags:** security, privacy, dlp
**Scope:** packages/cli/src/utils.ts

Always record post-DLP masked prompts in persistent storage to ensure that secrets or PII are not accidentally leaked into long-lived artifact files.
