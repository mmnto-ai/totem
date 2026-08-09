---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

User-file write-safety contract, eject slice (mmnto-ai/totem#2620; Tenet 4 User-File Mutation Contract corollary). Core ships `writeFileAtomicSync` — same-volume unique-temp + fsync + metadata-applied-to-the-temp, rename last, so observable state is old-bytes-or-new-bytes with mode, ownership, and symlink identity preserved — and the three prior inline temp+rename writers (worktree registry, sync-state/checkpoint/manifest, verification outcomes) consolidate onto it. Eject converts its five user-file write sites to the helper, writes `.git/hooks/<name>.totem-bak` recovery artifacts with the source hook's bytes and mode BEFORE any hook mutation (partial scrub and full removal both; a failed bak skips that hook's mutation entirely), senses uncommitted changes to its mutation roster ahead of the consent prompt (sense-and-say — never a block; `--force` skips the prompt, not the sense), and gains the Tenet-4 loud backstop: an eject where every reflex-file scrub write fails now throws `EJECT_FAILED` instead of exiting clean over skip lines.
