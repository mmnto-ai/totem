---
'@mmnto/cli': patch
---

`totem init` Gemini SessionStart hook template now calls `totem describe`
instead of `totem status`, matching the family-canonical convergence
(`totem-strategy`, `totem-substrate`, `arhgap11`, `totem-status` all
already use `describe`) and pairing symmetrically with the Claude-side
SessionStart hook scaffolded by the same init pass.

The two commands produce different output. `totem describe` emits the
`[Describe] Project: ... Lessons: N Targets: N Hooks: ...` orientation
banner that consumers integrate against at session start. `totem status`
emits "current project health" (manifest freshness, shield staleness)
which serves a different purpose. The init template had drifted to
`status` at some point; this restores the canonical pattern.

Also updates the `CLAUDE_MD_TEMPLATE` "Start of Session" prose to reflect
the role distinction: the SessionStart hook automatically runs `describe`
for orientation; agents can run `status` ad-hoc for freshness checks.

Closes `mmnto-ai/totem#1884`. Slice 2 of the original
`mmnto-ai/totem#1845` 3-way split; slice 1 (symmetric Claude SS hook)
shipped in `mmnto-ai/totem#1862`. Slice 3 (session-utility skill suite
distribution) remains queued.
