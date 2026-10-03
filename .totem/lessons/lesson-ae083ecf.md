## Lesson — The ignore writer reads once and writes once, atomically, before anything that can throw

**Tags:** init, fs, gitignore
**Scope:** packages/cli/**/*.ts, !**/*.test.*, !**/*.spec.*

The first version of the ignore writer made three read-modify-write passes over the user's `.gitignore`. It now reads the file once, builds the result in memory and writes it with the atomic-write helper, so an interrupted run leaves either the old file or the new one. An exact re-inclusion line the user wrote (a leading `!`) is honoured: the writer does not ignore again what the user re-included. The write also runs before every hook installer and before the Cursor instructions scan, because a throw in any of them would otherwise skip it; a fold had moved it below the scan and a second review caught the regression (mmnto-ai/totem#3013).
