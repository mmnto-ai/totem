---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem legs deposit` refuses a findings file that carries a bare `#NNN` reference anywhere in its text, before anything is written (mmnto-ai/totem#3023). The scan mirrors the compiled `xrepo-qualify-refs` rule's pattern (a `#` followed by digits that is not preceded by `<owner>/<repo>`, with no word character after the number), runs over the file's bytes rather than its parsed fields so no free-text field can hide one, and names each offending line with the cure: qualify the reference as `<owner>/<repo>#NNN` in the findings file and re-run. A deposit is a record and is never amended after the write, so the refusal sits at the writer; deposits already on a branch are untouched, and the lint rule's scope (committed markdown) does not change.
