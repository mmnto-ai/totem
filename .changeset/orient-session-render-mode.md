---
'@mmnto/cli': patch
---

feat(cli): orient cohort distribution (WS2 PR-3, #2044) — two parts:

1. `totem orient --session` render mode: emits the bounded session-orientation block for a SessionStart hook to inject. Reuses the shipped `deriveOrientReport` + `renderOrientForSession`, so the CLI surface, the `--json` report, and the in-process hook cannot diverge. Boot-safe per the SessionStart contract — never throws or exits non-zero, emits nothing when there is no high-signal state (the hook omits the block), and skips the hard `gh` gate so a consumer without `gh` degrades to fail-loud "could not derive" lines instead of an error banner.

2. The scaffolded SessionStart hooks (`CLAUDE_SESSION_START` + `GEMINI_SESSION_START`) now append `totem orient --session` after `totem describe` — additively (Tenet 13: `describe` = static identity sensor, `orient` = live in-flight sensor; append, never replace), each in its own boot-safe try/catch. New consumers get live derived orientation at session-start automatically; existing consumers pick it up on their next hook re-scaffold.
