## Lesson — When a generated prose sentence is restructured (a docs

**Tags:** docs-transforms, provenance, falsification-leg, trap, s6-regeneration

**Applies-to:** presentation

When a generated prose sentence is restructured (a docs transform, a report line), every figure in it must be computed over the set the prose attaches it to, and the placement must be pinned by a test on a fixture where the sets differ. The S6 step 7 re-word of the maturity provenance sentence moved "distinct lessons" to count over legacy rows only but left the engine counts and compile dates, computed over every row, inside the "The legacy rules compile from" clause: 293 ast-grep / 220 regex to 2026-10-10 over all rows against 268 / 217 to 2026-06-07 over the legacy rows. Found by falsification read 1 as the one MATERIAL on mmnto-ai/totem#3062; folded by attaching the parenthesis to the total and asserting both placements on a mixed fixture in tools/docs-transforms.test.cjs.

**Source:** mcp (added at 2026-10-13T06:58:01.815Z)
