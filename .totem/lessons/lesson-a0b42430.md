## Lesson — Differentiate empty corpus from disarmed enforcement

**Tags:** lint, architecture
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

A zero-rule load can represent an early-adoption repository, a legitimate all-archived lifecycle state, or a disarmed gate where a corpus exists but rules failed to load. Use a discriminator (like verifying source files) to distinguish legitimate empty states from enforcement failures. This reconciles two standing lessons that are each true in their own regime — "Gracefully skip linting on empty rules" (lesson-0fde21c0, the empty-corpus regime) and "Quality gate tools must never exit successfully" (.totem/lessons.md, the corpus-bearing regime); the on-disk corpus check is the boundary that decides which regime applies.
