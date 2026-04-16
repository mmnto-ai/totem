## Lesson — Prefer Monitor over Bash sleep loops

**Tags:** claude, tooling, performance
**Scope:** CLAUDE.md

Using the Monitor tool instead of shell polling loops prevents unnecessary cache context consumption during wait periods. Shell-based 'sleep; check' patterns burn tokens and context window on every iteration.
