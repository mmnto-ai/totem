---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

Skill-changing: the distributed `review-reply` skill carries the completion recipe for a bus audit (mmnto-ai/totem#2925). The skill said how a round is triaged and dispositioned on GitHub and nothing about how a reviewer ENDS a blind-round audit on the bus, and a liquid-city seat with `mail reply --help` in front of it still used separate send and mark calls for five audits. The rendered skill now says: a finished audit or round deposit ends with `totem mail reply <source dispatch path> --body-file <deposit>`, one call that sends the reply into your own outbox and writes the `processed/` mark for the source under the resident checkout that hosts the seat; `--no-mark` stages the reply and leaves the source unread for a later `totem mail mark <source>`; both calls run from that resident checkout, never a worktree (the reply refuses one; a standalone mark from one mints a phantom store, mmnto-ai/totem#2968); never a hand-written mark, never a separate send followed by one; the source path is the `read:` line under the item in `totem mail`'s listing (`filePath` under `--json`). The surface is review-reply rather than signoff because the recipe ends a ROUND, which review-reply owns (its disposition step is where a reviewer finishes), while signoff ends a session and signon begins one; the skill's one-line description now names the recipe so a seat ending an audit is routed to it. The constants test locks the clause. Every cohort repository takes it at its next skill re-render; strategy's skills lock compares the working-tree skills to the installed CLI constant and flips on every open strategy PR at this cut, so it rides a cut with no open strategy PR.
