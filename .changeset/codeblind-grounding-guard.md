---
'@mmnto/cli': minor
---

feat(spec,review): code-blind grounding guard — when `totem spec` / `totem review` retrieve zero code chunks, surface an advisory banner ("no code context — architecture claims unverified") and fold a suppression directive into the orchestrator prompt so the model degrades to the retrieved specs/sessions/lessons instead of confabulating file/type/system specifics (the lc#463 "invented a whole architecture" class). Interim fail-loud guard per strategy#474: the command still runs — it does NOT disable. The banner is the deterministic (code-emitted) guarantee; the prompt directive is best-effort. Fires strictly on 0 code, independent of specs/sessions/lessons. Hard structural post-checks remain the #474 redesign (mmnto-ai/totem#2103). (mmnto-ai/totem#2106)
