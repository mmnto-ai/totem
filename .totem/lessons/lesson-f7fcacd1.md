## Lesson — Update governance extractors during package renames

**Tags:** architecture, mcp, governance
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

Renaming packages within a fixed-versioning cohort requires updating internal state extractors to prevent incomplete governance or version reporting.
