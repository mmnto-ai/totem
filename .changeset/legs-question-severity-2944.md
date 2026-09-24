---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem legs deposit` admits `QUESTION` as a finding severity (mmnto-ai/totem#2944). The cohort's falsification legs return four classes in practice (BLOCKING, MATERIAL, MINOR, QUESTION) while the deposit schema admitted three, so a leg's question had to be re-typed as MINOR to land and the record was lossy; doctrine's § Typed deposits still names three, and the amendment naming the fourth is owed in the strategy lane. A question is now its own class: counted beside the three (`countLegFindings` gains `question`; a QUESTION is never re-typed as MINOR; a folded QUESTION counts in `folded` like any answered finding), printed on the deposit's summary and on the gate's evidence line, both as `blocking=N material=N minor=N question=N folded=N`, and absent from the covariate `leg:` field for the same reason MINOR is (the round rules on blocking and material). `LegFindingCounts` gains the required member `question`, which is why this is a minor bump. The deposit verb now always stamps the writer's schemaVersion, `1.1.0`, whatever label the findings file carried. Readers accept any 1.x; a 1.0 reader (a CLI before this change) refuses a deposit that carries a QUESTION as corrupt with the reason named, and the gate then finds no deposit for the head and blocks a legs-owed push, so a worktree whose dist predates this change, or a seat whose resolved `totem` is an older global, blocks on such a deposit until it is rebuilt or updated. The falsification-leg agent definition and the CLI reference in this repository name the fourth class.
