---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-agent-workflow': minor
'@mmnto/pack-rust-architecture': minor
---

A leg deposit that carries a bare `#NNN` reference in any of its strings is refused at write time, in the library and in the verb (mmnto-ai/totem#3023). Core gains three public exports, hence the minor: the pattern (`BARE_REF_REGEX_SOURCE`, the compiled `xrepo-qualify-refs` rule's and the write shield's: a `#` followed by digits that is not preceded by `<owner>/<repo>`, with no word character or hyphen after the digits), a walk over the DECODED strings of a value (`findBareRefsInLegDeposit`, keys and values at every depth, each hit with an injective JSON path), and a typed refusal (`LegDepositBareRefError`, the new error code `LEG_DEPOSIT_BARE_REF`); `saveLegDeposit` runs the walk on the validated deposit and refuses before the address is looked at, so every library caller is held to the rule. `totem legs deposit` runs the same walk on the parsed findings file, refuses with the same code, and adds what the library cannot know: each offending line of the file, found by the carrying string's canonical JSON token at a token boundary, the first ten lines then a count of the rest; a reference whose carrying string is not in the file in canonical form (any JSON escape in it) is named as not located rather than guessed at. The cure is in both messages: qualify each as `<owner>/<repo>#NNN` and re-run. A deposit is a record and is not amended after the write, so the refusal sits at the writer; deposits already on a branch are untouched, and the lint rule's scope (committed markdown) does not change.
