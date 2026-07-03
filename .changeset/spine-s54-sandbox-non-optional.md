---
'@mmnto/cli': patch
---

`totem rule author`: the ADR-112 §5.4 author sandbox is now fail-loud NON-OPTIONAL when the authoring header names a frozen split artifact — omitting `--lc-dir` under a content-addressed `splitRef` throws `GATE_INVALID` at binding-engagement instead of silently skipping the sandbox reachability proof (the independence axiom forbids an author-owned knob whose omission disables the guard; found by the #2294 couple verification). The legacy free-text `splitRef` lane binds nothing and is byte-unaffected.
