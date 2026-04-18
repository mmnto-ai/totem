---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

Config-driven source-extension list for the review content hash.

Polyglot repos can now override the historical `['.ts', '.tsx', '.js', '.jsx']` set by declaring `review.sourceExtensions` in `totem.config.ts`. The CLI writes the validated set to `.totem/review-extensions.txt` on every `totem sync`, and `.claude/hooks/content-hash.sh` reads it so both implementations stay in lockstep. Defaults are unchanged; consumers who do not set the field see no behavior difference. Closes #1527 and #1529.
