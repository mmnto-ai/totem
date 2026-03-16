---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

perf: cache non-compilable lessons to skip recompilation (#590)

`totem compile` now caches lesson hashes that the LLM determined cannot be compiled. Subsequent runs skip them instantly. `totem wrap` goes from ~15 min to ~30 seconds.

fix: remove duplicate compiled rule causing false positives (#589)

Root cause was duplicate rules from compile, not a glob matching bug. Removed the broad duplicate.

feat: auto-ingest cursor rules during totem init (#596)

`totem init` scans for .cursorrules, .mdc, and .windsurfrules. If found, prompts user to compile them into deterministic invariants.

fix: strip known-not-shipped issue refs from docs generation (#598)

Ends the #515 hallucination that recurred in 5 consecutive releases. Pre-processing strips from git log, post-processing strips from LLM output.
