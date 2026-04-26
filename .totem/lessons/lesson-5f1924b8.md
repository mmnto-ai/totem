## Lesson — Default missing metadata to inclusive values

**Tags:** metadata, architecture, filtering
**Scope:** packages/core/src/types.ts

Defaulting missing or empty categorization fields to an 'any' value ensures backwards compatibility and prevents filtering logic from accidentally excluding records due to empty matches.
