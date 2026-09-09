## Lesson — totem mail mark does not resolve the bare filename

**Tags:** mail, ecl, trap, cli

`totem mail mark` does not resolve the bare filename that `totem mail` displays — it opens the argument relative to cwd and fails ENOENT (mmnto-ai/totem#2527 still open as of cli 2.2.1). Mark by the full `filePath` from `totem mail --json`, then re-poll to confirm clean. Also still true on 2.2.1: `mail send` derives a filename whose subject-kebab truncates before the sender seat short — rename the outbox file to carry `-<seat>` after every send.

**Source:** mcp (added at 2026-09-08T20:48:58.436Z)
