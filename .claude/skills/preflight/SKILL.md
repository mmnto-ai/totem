---
name: preflight
description: Pre-work ritual — run totem spec and search knowledge before starting a ticket
---

Before starting work on issue $ARGUMENTS:

1. Run `pnpm exec totem spec $ARGUMENTS` to generate an implementation spec
2. Call `mcp__totem-dev__search_knowledge` with a query describing the changes you're about to make
3. Summarize: what the spec says, what lessons are relevant, and any constraints or traps

Do NOT start writing code until these steps complete. If spec fails, report the error and stop.

After successful completion, create the spec gate flag with the ticket number:
`mkdir -p .totem/cache && echo "$ARGUMENTS" | grep -oE '[0-9]+' | head -1 > .totem/cache/.spec-completed`
