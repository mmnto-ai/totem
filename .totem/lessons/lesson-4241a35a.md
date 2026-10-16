## Lesson — A leg brief that lists the refusal cases

**Tags:** falsification-leg, leg-brief, input-space, invariant, gate-5, harness, trap

**Applies-to:** any

A leg brief that lists the refusal cases by the implementation's own flags inherits the implementation's blind spot. On mmnto-ai/totem#3080 (2026-10-14) three falsification reads "held" the mig-harness's iv refusal for the modes the brief named (--set and --r14), and a bot found the third run mode (a --seed/--corpus run without --r14) cold: the refusal keyed on the --r14 flag, not on the absence of --set, so a plain seed run admitted a declaration no mode should. Rule for a brief: name the INVARIANT ("a declaration is admissible only in the migration run") and have the leg enumerate the input space from the parser (every mode the argv parser admits, every spelling a shell hands you — lesson-dc2971d4), never from the diff's narration or the author's case list; a read that confirms the author's enumeration confirms the author. Bots stay the final pass on apparatus changes. The fold keyed the refusal on the mode (no --set) and added arm A6b; the side agent surfaced the brief lesson the same day.

**Source:** mcp (added at 2026-10-16T00:50:11.962Z)
