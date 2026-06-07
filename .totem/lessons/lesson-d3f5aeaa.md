## Lesson — Include all bot IDs in triage parsers

**Tags:** dx, tooling, github-actions
**Scope:** packages/cli/src/parsers/bot-review-parser.ts

Triage and review parsing tools must explicitly include all active bot identifiers (e.g., `greptile-apps[bot]`) to prevent critical feedback from being silently ignored by automation.
