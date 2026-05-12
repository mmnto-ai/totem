---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(hook): bot-pack wiring engine — CLI surface (ADR-104 PR-1 follow-on slice 1)

Adds the `totem hook` noun-verb namespace with three subcommands. The legacy
plural `totem hooks` (git-hooks installer) becomes a hidden one-cycle
deprecation alias for the new `totem hook install`.

New commands:

- `totem hook run --tool <name> --args <args>` — PreToolUse runtime
  entrypoint. Loads `.totem/compiled-hooks.json`, evaluates each compiled
  hook against the tool-call payload, and emits a structured
  `[totem:hook-block]` rejection (exit code 2) on the first match. Allow
  path is exit code 0 with no output.
- `totem hook install` — git-hooks installer (renamed from `totem hooks`).
  Same behavior; the legacy plural remains as a hidden deprecation alias
  for one cycle.
- `totem hook test [--filter <term>]` — runs fixtures with `surface: hooks`
  against compiled-hooks rules. Per-line failure reporting
  (`missed reject` / `false positive`). Fails loud on manifest load
  errors and on orphan fixtures referencing unknown hook ids
  (Tenet 4 — no silent passes when pack wiring is broken).

Public API:

- `@mmnto/totem :: runRuleTests` now filters fixtures to `surface: 'rules'`
  (defaults to `'rules'` when absent — backwards-compat). Hooks-surface
  fixtures are dispatched through the new CLI `runHookTests` runner
  instead of surfacing as unknown-hash failures under `totem test`.

Also includes the foundation API surface from #1894 that had not shipped
under a changeset: `TotemErrorCode.HOOKS_LOAD_FAILED` and the re-exported
`isRegexSafe` helper.

Deferred from this slice:

- `totem test` → `totem rule test` rename. The existing `totem rule test <id>`
  command (inline-lesson-example verifier) collides on the `test` subcommand
  name with different semantics. Conflict resolution + rename lands in
  slice 2 alongside `totem sync` integration and the cross-OS smoke matrix.
