---
'@mmnto/cli': patch
---

fix(skills): the distributed `review-reply` skill's Phase 1 line invokes the triage as `pnpm exec totem triage-pr $ARGUMENTS`, with the node-path form beside it for a checkout whose workspace build is the intended binary, instead of the bare `pnpm totem triage-pr`, which is neither a declared script nor an explicit bin and once rode pnpm's shim fallback into a `cmd` banner on a Windows consumer (mmnto-ai/totem#2903; a single occurrence, not reproduced since). Both copies re-stamp on the consumer's next `totem init` wherever init writes them — the `.claude/skills` copy with the Claude surface, the `.agents/skills` twin wherever the init cwd carries an `.agents/` directory — as long as the file still carries its canonical markers; a marker-less copy is preserved until `--force-skill-refresh`.
