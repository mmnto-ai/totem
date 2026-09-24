---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem mail send --workspace <path>` and `totem mail reply <source> --workspace <path>` now reach the library (mmnto-ai/totem#2939). The parent `mail` command declares `--workspace` for the poll, and Commander lets a parent claim its option even when it is typed after a subcommand, so the flag landed on the parent's scope and the lib saw `workspace: undefined`; the recipient validation then fell back to `TOTEM_WORKSPACE` or the parent of the repo root, and a consumer whose workspace is elsewhere got the unknown-recipient warning it had tried to avoid. The two actions read `workspace` back through `optsWithGlobals`, exactly as the poll and `mail verify` actions do (the mmnto-ai/totem#2097 seam); every other option is read from the subcommand's own scope as before. The Commander wiring mirror gains `mail send` and the `--workspace` cases for send and reply in both flag positions.
