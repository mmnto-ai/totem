## Lesson — A line the CLI entry prints reaches every hook that runs it

**Tags:** cli, hooks, stderr, re-exec
**Scope:** packages/cli/src/reexec-local.ts, packages/cli/src/index.ts

The first freshness sensor also printed on a direct run of the workspace build. A falsification read traced where that stderr goes in this repository: the session-start hooks inject the child's stderr into the session prompt, the gate wrapper passes it through on every shell call, and the pre-push hook prints it once per step. A line added at the CLI's entry is therefore a line added to every automated surface that spawns the CLI. The sensor was narrowed to the delegation path; a direct run prints nothing new and reads no source tree (mmnto-ai/totem#2998).
