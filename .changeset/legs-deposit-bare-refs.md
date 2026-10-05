---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem legs deposit` refuses a findings file that carries a bare `#NNN` reference in any of its strings, before anything is written (mmnto-ai/totem#3023). The scan mirrors the compiled `xrepo-qualify-refs` rule's pattern (a `#` followed by digits that is not preceded by `<owner>/<repo>`, with no word character or hyphen after the digits) and runs over the DECODED strings of the parsed file, keys and values at every depth, so a reference authored as a JSON escape is caught as what it decodes to and a qualified reference with an escaped slash is read as qualified. Each offending line of the file is named with the references on it, the first ten lines then a count of the rest; a reference whose literal does not appear in the file's text is named as escaped. The cure is in the message: qualify each as `<owner>/<repo>#NNN` in the findings file and re-run. A deposit is a record and is not amended after the write, so the refusal sits at the writer; deposits already on a branch are untouched, and the lint rule's scope (committed markdown) does not change.
