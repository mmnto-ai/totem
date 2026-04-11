---
'@mmnto/cli': patch
---

Refactor `totem handoff` to a deterministic journal scaffold (#1316)

`totem handoff` previously generated its output via an LLM call, which made the command slow, non-reproducible, and gated on provider availability. It's now a deterministic scaffold: the command reads git state, recent commits, and the active journal directory, then writes a pre-filled template the user (or an agent) can flesh out.

Closes #1310. Also removes ~500 lines of dead orchestration code that was only used by the old LLM path.
