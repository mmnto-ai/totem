---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem mail`'s human listing names where to read each unread dispatch (mmnto-ai/totem#2919): every item now carries a third line, `read: <absolute path>`, the same `filePath` the `--json` output emits, under both the directed listing and the identity-gated broadcast listing. Before this a reader saw only the basename and had to know the sender's outbox layout; one consumer improvised with a directory listing of the sender's outbox and saw other seats' dispatches from the same round during a BLIND window. The empty-inbox lines, the `--json` shape and the exit codes are unchanged; the `mail` help text names the new line. A test locks the line's position under each item and its identity with the `--json` path.
