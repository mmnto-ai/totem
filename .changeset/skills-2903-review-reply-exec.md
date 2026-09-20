---
'@mmnto/cli': patch
---

fix(skills): the distributed `review-reply` skill's Phase 1 line invokes the triage as `pnpm exec totem triage-pr $ARGUMENTS`, with the node-path form beside it for a checkout whose workspace build is the intended binary, instead of the bare `pnpm totem triage-pr`, which is neither a declared script nor an explicit bin and once rode pnpm's shim fallback into a `cmd` banner on a Windows consumer (mmnto-ai/totem#2903; a single occurrence, not reproduced since). Both the `.claude/skills` copy and the `.agents/skills` twin re-stamp on every consumer's next `totem init`.
