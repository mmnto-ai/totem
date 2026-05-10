---
'@mmnto/totem': patch
---

`generateLessonHeading` / `truncateHeading` now strip clause-internal-cut tails
where a verb/adjective-shaped trailing word is anchored to an immediately-preceding
preposition. Closes the per-postmerge-cycle tax LC was paying on extracted
headings like:

- `Validate const_name suffix before codegen to prevent` → `Validate const_name suffix before codegen`
- `RON tuple syntax differs from array syntax for fixed-size` → `RON tuple syntax differs from array syntax`
- `Snapshot canonical form should exclude metadata to isolate` → `Snapshot canonical form should exclude metadata`
- `Document pre-resource call sites to enable auditable` → `Document pre-resource call sites`

The prior single-word `DANGLING_TAIL_RE` only caught trailing prepositions
(`...for the`); it didn't recognize that `<prep> <expectant-word>` patterns
(`...to prevent`, `...for fixed-size`) leave the heading mid-clause.

The fix walks backwards from the end of the heading collecting consecutive
expectant-shaped words (verb/adjective suffixes `-ate|-ize|-ify|-able|-ible|-ing|-ent|-ant`,
or hyphenated compounds), then checks the IMMEDIATE anchor word. If the
anchor is a preposition, the run is stripped and the existing dangling-tail
check removes the prep too. The immediate-adjacency check protects common
nouns ending in those suffixes (`component`, `client`, `state`, `environment`,
`load-balancer`) — when an article like `the` sits between the preposition
and the noun, the run stops at the noun and the heading is preserved.

Closes `mmnto-ai/totem#1872`. Original fix in `mmnto-ai/totem#253` / `mmnto-ai/totem#348`
addressed an earlier shape; this regression is the same defect class re-emerging
from extractor LLM output that produces phrasings the prior heuristic didn't cover.

Empirical evidence base: three consecutive `mmnto-ai/liquid-city` postmerge cycles
(`mmnto-ai/liquid-city#229` 75% truncated, `mmnto-ai/liquid-city#234` 33% truncated,
`mmnto-ai/liquid-city#238` 14% truncated) — pattern stable across cycles, fix
addresses all observed cases.
