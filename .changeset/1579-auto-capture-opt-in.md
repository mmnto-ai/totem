---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
'@totem/pack-agent-security': patch
---

Flip Pipeline 5 auto-capture on `totem review` from opt-out to opt-in.

`--no-auto-capture` is renamed to `--auto-capture`; the default is now OFF. Observation rules captured from review findings are context-less (regex drawn from the flagged line, message taken from the reviewer, `fileGlobs` scoped to the whole codebase) and routinely pollute `compiled-rules.json` with rules that fire on unrelated files. The Liquid City Session 6 audit measured an 8-rule wave across 5 review invocations producing 13 new warnings on the next `totem lint`, up from 0.

To preserve the old behavior, pass `--auto-capture` explicitly. Auto-capture will resume as a default once ADR-091 Stage 2 Classifier + Stage 4 Codebase Verifier ship in 1.16.0 and the LLM-emitted rule loop has gates that prevent context-less emissions.

Closes #1579.
