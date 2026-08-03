# Spec: refresh-gh hook wiring (mmnto-ai/totem#2556)

> Hand-authored 2026-08-03T0107Z — the `totem spec` Gemini call returned an empty
> body (1 output token; same class as status-claude's 2026-08-02T0504Z
> spec-retrieval-defect dispatch to strategy). Authored from primaries:
> the routed dispatch (2026-08-02T0136Z, in processed/), install-hooks.ts,
> init-templates.ts.

## Goal

The three totem-managed hook templates gain a spawn-and-forget invocation of
`totem-status refresh-gh`, discharging the mmnto-ai/totem-status#127 C3
residual (refresh moments 3 + 4: SessionStart, post-merge).

## Surfaces

1. `CLAUDE_SESSION_START` — packages/cli/src/commands/init-templates.ts:676
   (`.claude/hooks/SessionStart.cjs`, MANAGED_SESSION_HOOKS roster)
2. `GEMINI_SESSION_START` — packages/cli/src/commands/init-templates.ts:167
   (`.gemini/hooks/SessionStart.js`, same roster; vehicle parity)
3. `buildHookContent()` — packages/cli/src/commands/install-hooks.ts:166
   (git post-merge, bounded owned region via TOTEM_HOOK_MARKER/END)

## Contract (theirs)

exit 0 = snapshot written (atomic rename, stamped fetchedAt); exit 1 = disk
untouched. Single-flight vs daemon; no-clobber when `gh` missing; never wedges
past deadline+WaitDelay. Safe to fire blind.

## Constraints (ours)

- Never block: #2059 measured ~3s sync-gh SessionStart cost. Node surfaces use
  detached+unref `spawn` with `stdio: 'ignore'`; sh surface uses a backgrounded
  subshell with output discarded.
- Presence-gated, zero-noise when absent: `command -v totem-status` (sh);
  ENOENT-silent `error` handler (Node), non-ENOENT keeps a stderr breadcrumb.
- PRIMARY-checkout-gated (`.git` must be a DIRECTORY; build-time discovery
  2026-08-03): a detached child inherits its parent's cwd, and on Windows that
  holds a directory lock for the child's lifetime. In a linked worktree
  (.git = pointer file) that lock breaks worktree removal — the cohort's agent
  flows create/destroy worktrees constantly — and the hook runtime tests
  reproduced it as EPERM on tmpdir cleanup (5 failures, machine with the
  sidecar on PATH). Worktrees + non-git cwds skip; the primary's hooks + the
  30m daemon tick cover the workspace-level snapshot, single-flight makes
  duplicate fires redundant.
- No new distribution mechanism — drift-repair (bounded regions / roster).
- Templates must keep opening with SESSION_START_MARKER (doctor-parity
  contract) and keep end markers last (bounded-ownership contract).

## Tests

- init.test.ts template suites: new `toContain` assertions (spawn call,
  detached/unref, ENOENT guard) on both SessionStart templates.
- install-hooks.test.ts: post-merge template carries the presence-gated
  backgrounded invocation; end-marker still terminal.
- doctor-parity.test.ts marker contract untouched (no assertion change needed
  unless it snapshots full content — it does not; it checks startsWith marker).

## Non-goals

- No arming verification, no snapshot consumption, no daemon interplay — the
  sidecar owns all of that (measurement-or-nothing is their contract line).
- No pre-push/pre-commit wiring: C3 names SessionStart + post-merge only.

## Release

Changeset: `@mmnto/cli` minor. Docs: `docs/wiki/hook-integration.md` gains the
refresh line. Reply dispatch with anchor already sent (2026-08-03T0104Z).
