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

When the `totem-status` sidecar binary is on `PATH` **and** the working copy is a primary checkout (`.git` is a directory, not a worktree pointer file), the managed `post-merge` git hook and the Claude/Gemini SessionStart session hooks additionally fire two spawn-and-forget sidecar verbs: `totem-status refresh-gh`, a refresh of the GitHub-lane status snapshot, and `totem-status refresh-obligation-store`, which writes the durable obligation store ([mmnto-ai/totem-status#127](https://github.com/mmnto-ai/totem-status/issues/127); the GH half is tracked in [mmnto-ai/totem#2556](https://github.com/mmnto-ai/totem/issues/2556)). Both ride the same gate, so a repo that skips one skips both. Linked worktrees skip deliberately: a detached child inheriting a worktree cwd holds a Windows directory lock that breaks worktree removal, and the primary checkout's hooks plus the sidecar daemon already cover the workspace-level snapshot. The invocation is fully asynchronous: repos without the sidecar see no output and no latency, and session start / merge completion never wait on either refresh.

Each firing is observable (mmnto-ai/totem#2570): the hook appends a one-line stamp to a repo-local log at `.git/totem-status-refresh-hook.log` (never tracked; self-caps at 1 MiB) and hands the child the same log, so the verb's own success line lands after the stamp — a stamp with nothing after it means the child never finished, discriminating a hook-harness process-tree reap from a child failure. Every stamp names the verb it fired (`verb=refresh-gh` / `verb=refresh-obligation-store`), so the two children sharing one log stay tellable apart. The Node session-hook stamps carry cwd plus PATH/cwd-shadow diagnostics; the post-merge stamp carries the resolved binary path. Firings within one repo interleave — the two verbs of a single firing, and a session start racing a merge — so pair stamp to verb line by time window and `verb=`, not strict adjacency; single-flight keeps this rare. If the log is unwritable the hooks fall back to the previous blind firing, silently.
