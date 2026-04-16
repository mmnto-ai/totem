## Lesson — Guard hook exit code invariants

**Tags:** bash, automation, reliability
**Scope:** .claude/hooks/**/*.sh

Hooks must coerce all runtime failures to exit 1 to prevent blocking critical operations like compaction, which are only halted by an exit 2.
