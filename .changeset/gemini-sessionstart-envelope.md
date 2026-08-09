---
'@mmnto/cli': patch
---

fix(hooks): the distributed Gemini `SessionStart.cjs` template emits the `hookSpecificOutput.additionalContext` envelope (mmnto-ai/totem#2613). Interactive Gemini ingests SessionStart output only from that envelope — plain exit-0 stdout wraps as `systemMessage`, which the interactive startup consumer never reads, so the briefing was silently dropped in the primary dev flow even once registered. The template now captures both briefing legs (`totem describe` + `totem orient --session`) and emits the same envelope the Claude-side hook uses; the fail-soft boot contract is unchanged (exit 0 always; a totem-unresolvable note rides the envelope so it reaches interactive context). Per-leg budgets drop 30s→20s so the worst case stays inside Gemini's 60s default hook timeout. Surface change: the `gemini -p` and `/clear` paths previously displayed the plain text as `systemMessage`; the briefing now travels as injected model context instead — its actual purpose.
