# Git Hook Integration

Totem enforces its rules locally using Git hooks, preventing bad code from ever leaving the developer's machine.

You can install or update the hooks using:

```bash
totem hook install
```

## Supported Hooks

- **`pre-commit`**: Fast checks for obvious violations.
- **`pre-push`**: Fast, local `totem lint` execution before pushing to a remote.
- **`post-merge` / `post-checkout`**: Re-syncs the local LanceDB index if lessons or rules have changed.

## Sidecar refresh (optional)

When the `totem-status` sidecar binary is on `PATH` **and** the working copy is a primary checkout (`.git` is a directory, not a worktree pointer file), the managed `post-merge` git hook and the Claude/Gemini SessionStart session hooks additionally fire `totem-status refresh-gh` — a spawn-and-forget refresh of the GitHub-lane status snapshot ([mmnto-ai/totem-status#127](https://github.com/mmnto-ai/totem-status/issues/127), tracked in [mmnto-ai/totem#2556](https://github.com/mmnto-ai/totem/issues/2556)). Linked worktrees skip deliberately: a detached child inheriting a worktree cwd holds a Windows directory lock that breaks worktree removal, and the primary checkout's hooks plus the sidecar daemon already cover the workspace-level snapshot. The invocation is fully asynchronous: repos without the sidecar see no output and no latency, and session start / merge completion never wait on the refresh.
