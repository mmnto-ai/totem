---
"@mmnto/cli": minor
"@mmnto/totem": minor
---

feat(hook): bot-pack wiring engine — CLI surface (ADR-104 PR-1 follow-on slice 1)

Adds the `totem hook` noun-verb namespace and the `totem rule test` rename, with
hidden one-cycle deprecation aliases preserving the existing surfaces.

New commands:

- `totem hook run --tool <name> --args <args>` — PreToolUse runtime entrypoint. Loads
  `.totem/compiled-hooks.json`, evaluates each compiled hook against the tool-call
  payload, and emits a structured `[totem:hook-block]` rejection (exit code 2) on
  the first match. Allow path is exit code 0 with no output.
- `totem hook install` — renames `totem hooks` (plural). Same behavior; the legacy
  surface remains as a hidden deprecation alias for one cycle.
- `totem hook test [--filter <term>]` — runs fixtures with `surface: hooks`
  against compiled-hooks rules. Per-line failure reporting (`missed reject` /
  `false positive`) so authors can iterate on specific payloads.
- `totem rule test [--filter <term>]` — renames `totem test`. The legacy `totem test`
  surface remains as a hidden deprecation alias for one cycle.

Public API:

- `@mmnto/totem :: runRuleTests` now filters fixtures to `surface: 'rules'`
  (defaults to `'rules'` when absent — backwards-compat). Hooks-surface fixtures
  are dispatched through the new CLI `runHookTests` runner instead of surfacing
  as unknown-hash failures under `totem rule test`.

Includes the foundation API surface from #1894 that had not shipped under a
changeset: `TotemErrorCode.HOOKS_LOAD_FAILED` and the re-exported `isRegexSafe`
helper.

Slice 2 (deferred to next session): `totem sync` integration for hook compilation
and the cross-OS smoke matrix (ubuntu, windows, windows-via-MSYS) in CI.
