## Lesson — Filter rule verification by fileGlobs

**Tags:** linting, tooling, architecture
**Scope:** .totem/compiled-rules.json

Verification stages must filter codebase matches against a rule's `fileGlobs` before archiving for over-breadth to avoid false positives from historical mentions in changelogs or documentation.
