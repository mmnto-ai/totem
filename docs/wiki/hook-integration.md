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

## The managed block and your own extensions

Each installed hook is bounded by a start marker (its first comment line, e.g. `# [totem] pre-commit hook`) and an end marker (`# [totem] end pre-commit`). Everything between them is Totem's — regenerated from the running `@mmnto/cli`'s template on every install. Everything after the end marker is yours.

To keep your own lines through upgrades, attest them. Head the trailing content with a fork marker on a comment line, carrying all three fields:

```sh
# [totem] end pre-commit
# <!-- totem:fork reason="docs-inject extension" owner="your-handle" attested="2026-06-07" -->
if [ -f "docs/wiki/Home.md" ]; then
  echo "[repo] docs-inject extension"
fi
```

A bare `totem hook install` (and `totem init`) then rewrites the managed block in place and carries your extension through byte-for-byte. Trailing content with no attestation — or with a bare `<!-- totem:fork -->`, or one missing any of `reason` / `owner` / `attested` — is left strictly alone: the install declines rather than risk clobbering it, and the cure is to delete the totem block through its end marker and re-run `totem hook install` to re-append it, or to take `totem hook install --force` and accept that it rewrites the whole file. Only the trailer's FIRST non-blank line is read: an attestation buried below other lines does not vouch for the lines above it.

`totem doctor`'s **Git Hooks** row compares every managed block against that canonical, on every install. (Before [mmnto-ai/totem#2753](https://github.com/mmnto-ai/totem/issues/2753) it compared only when the repo configured a non-default `totemDir`, so a hook frozen at an older template read as healthy on the common default — presence was never the question the row is asked.) A stale block is a `warn`, never a gate, and the remediation names the one command that fits the file's shape.

## Sidecar refresh (optional)

When the `totem-status` sidecar binary is on `PATH` **and** the working copy is a primary checkout (`.git` is a directory, not a worktree pointer file), the managed `post-merge` git hook and the Claude/Gemini SessionStart session hooks additionally fire two spawn-and-forget sidecar verbs: `totem-status refresh-gh`, a refresh of the GitHub-lane status snapshot, and `totem-status refresh-obligation-store`, which writes the durable obligation store ([mmnto-ai/totem-status#127](https://github.com/mmnto-ai/totem-status/issues/127); the GH half is tracked in [mmnto-ai/totem#2556](https://github.com/mmnto-ai/totem/issues/2556)). Both ride the same gate, so a repo that skips one skips both. Linked worktrees skip deliberately: a detached child inheriting a worktree cwd holds a Windows directory lock that breaks worktree removal, and the primary checkout's hooks plus the sidecar daemon already cover the workspace-level snapshot. The invocation is fully asynchronous: repos without the sidecar see no output and no latency, and session start / merge completion never wait on either refresh.

Each firing is observable (mmnto-ai/totem#2570): the hook appends a one-line stamp to a repo-local log at `.git/totem-status-refresh-hook.log` (never tracked; self-caps at 1 MiB) and hands each child the same log as it is spawned, so a child's output lands after that child's own stamp. Every stamp names the verb it fired (`verb=refresh-gh` / `verb=refresh-obligation-store`), so the log records which verbs fired and in what order. Read the reap signal narrowly: the parent writes the stamps in spawn order, each child is spawned immediately after its own stamp, and child output carries no verb tag and can interleave anywhere after that point, so a silent tail attributes only to the **last** verb stamped — it no longer discriminates a hook-harness process-tree reap from a child failure per child. That reopens if the sidecar tags its own output. The Node session-hook stamps carry cwd plus PATH/cwd-shadow diagnostics; the post-merge stamp carries the resolved binary path. Firings within one repo interleave — the two verbs of a single firing, and a session start racing a merge — so pair stamp to verb line by time window and `verb=`, not strict adjacency; single-flight keeps this rare. If the log is unwritable the hooks fall back to the previous blind firing, silently.

`refresh-obligation-store` requires a `totem-status` at slice two (commit `711f07a`) or later. An older sidecar does not reject the unknown verb — it falls through to the default dashboard, so the full status report lands in the hook log instead (measured: exit 0, ~179 KB per firing in a cohort checkout). A quiet non-zero exit on an unknown verb is an open question with the sidecar owner; until it closes, an oversized hook log on a stale sidecar is the expected symptom.
