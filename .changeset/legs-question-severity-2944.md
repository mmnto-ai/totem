---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem legs deposit` admits `QUESTION` as a finding severity (mmnto-ai/totem#2944). The cohort's typed-deposit shape carries four classes (BLOCKING, MATERIAL, MINOR, QUESTION) and the deposit schema admitted three, so a leg's question had to be re-typed as MINOR to land and the record was lossy. A question is now its own class: counted beside the three (`countLegFindings` gains `question`; a QUESTION is never re-typed as MINOR), printed on the deposit's summary (`blocking=N material=N minor=N question=N folded=N`) and on the gate's evidence line (`… blocking=N material=N question=N folded=N`), and absent from the covariate `leg:` field for the same reason MINOR is (the round rules on blocking and material). Deposits are written with schemaVersion `1.1.0`; readers accept any 1.x, and a 1.0 reader refuses only a deposit that carries a QUESTION. The falsification-leg agent definition in this repository names the fourth class.
