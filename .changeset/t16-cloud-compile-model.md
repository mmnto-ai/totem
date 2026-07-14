---
'@mmnto/cli': patch
---

fix(compile): cloud compile fails loud when no model is resolvable instead of silently substituting a hardcoded vendor default (Tenet-16 corollary, mmnto-ai/totem-strategy#800 item 1).

The `--cloud` request body's `model` field fell back to a concrete `'gemini-3-flash-preview'` where the three manifest-provenance sibling sites fall back to `'unknown'`. Unlike those provenance stamps, this is a live request parameter sent to the cloud worker — so the fix is not `'unknown'` but a loud `CONFIG_INVALID` error before any token exec or network call when neither `--model` nor `orchestrator.defaultModel` resolves.

Consumer-impact: CLI surface — `totem lesson compile --cloud` invoked with no `--model` and no `orchestrator.defaultModel` now errors loudly instead of silently compiling via an undeclared vendor model. Cloud runs with an explicitly resolved model are byte-identical; the local compile path is untouched.
