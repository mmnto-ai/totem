## Lesson — The CLI's lesson commands spawn themselves for the sync

**Tags:** cli, process, node
**Scope:** packages/cli/src/commands/add-lesson.ts, packages/cli/src/commands/lesson.ts

`totem add-lesson` and `totem lesson add` start their background `totem sync --incremental` by spawning the running CLI itself: `process.execPath` plus `process.argv[1]`, detached, with no lockfile read, no resolver and no shell. Before, each carried an inline detector that picked the command from the lockfile and ended in a bare `npx totem`. Those two copies are deleted, and so is the MCP package's detector. When the running entry is unknown the sync is skipped with a warning. The lite entry's `lesson add` passes `backgroundSync: false` and prints one line saying the index was not refreshed, because the lite build has no `sync` command (mmnto-ai/totem#3018).
