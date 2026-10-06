## Lesson — The bare-ref refusal guards the deposit write path only

**Tags:** legs-deposit, legs-gate, validation, ruling, follow-up
**Scope:** packages/core/src/artifacts/legs.ts, packages/cli/src/commands/legs.ts

The check lives in core's `saveLegDeposit`, after the schema parse and before the occupied-address check, so every writer that reaches the store passes it; the verb adds the file-line rendering on top (mmnto-ai/totem#3025). The legs gate that reads deposits at push time does not run it. That split was ruled before the build: a reader-side check would have to decide what to do with the historical deposits already on main, and a sweep of those records was declined because a deposit is a record and is never amended. A hand-assembled deposit committed without the verb therefore reaches the gate unchecked, which the first leg named against the PR body's one-caller claim; whether the gate should warn or refuse on a bare reference it reads, and for which deposits, is the open design question on mmnto-ai/totem#3026. The refusal exits 1 like the verb's other refusals, not the exit 2 the issue wrote; the deviation and its reason are recorded on mmnto-ai/totem#3023.
