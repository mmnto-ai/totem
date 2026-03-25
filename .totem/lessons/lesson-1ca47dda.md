## Lesson — Tools and agents that write files must resolve paths

**Tags:** agent-discipline, file-io, monorepo, cwd, trap

Tools and agents that write files must resolve paths from the project root (where the config file lives), never from process.cwd(). When task runners like turbo invoke commands from package subdirectories, CWD-relative writes spray orphaned artifacts (e.g., .totem/cache/, scratchpad files) into random locations across the monorepo. Always resolve totemDir from the config loader's known path, not from the current working directory.

**Source:** mcp (added at 2026-03-24T22:31:03.101Z)
