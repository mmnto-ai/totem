---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

A leg deposit that carries a bare `#NNN` reference in any of its strings is refused at write time, in the library and in the verb (mmnto-ai/totem#3023). Core exports the pattern (`BARE_REF_REGEX_SOURCE`, the compiled `xrepo-qualify-refs` rule's and the write shield's: a `#` followed by digits that is not preceded by `<owner>/<repo>`, with no word character or hyphen after the digits), a walk over the DECODED strings of a value (`findBareRefsInLegDeposit`, keys and values at every depth, each hit with its JSON path), and a typed refusal (`LegDepositBareRefError`, code `LEG_DEPOSIT_BARE_REF`); `saveLegDeposit` runs the walk on the validated deposit and refuses before anything is written, so every library caller is held to the rule. `totem legs deposit` runs the same walk on the parsed findings file and adds what the library cannot know: each offending line of the file, found by the carrying string's canonical JSON token, the first ten lines then a count of the rest, and outside that cap the references whose token is not in the text in canonical form, named as escaped. The cure is in the message: qualify each as `<owner>/<repo>#NNN` in the findings file and re-run. A deposit is a record and is not amended after the write, so the refusal sits at the writer; deposits already on a branch are untouched, and the lint rule's scope (committed markdown) does not change.
