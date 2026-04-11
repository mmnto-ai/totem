---
'@mmnto/cli': patch
---

Use `[Review]` as the log prefix for `totem review` output (#1335)

The `totem review` command was still printing `[Shield]` as the log prefix on every status line — a holdover from before the `shield` → `review` rename. Added a new `DISPLAY_TAG = 'Review'` constant in `shield-templates.ts` and routed every `log.info` / `log.dim` / `log.warn` / `log.success` call through it. The existing `TAG = 'Shield'` constant is kept verbatim because it's still used as the lookup key for `orchestrator.overrides.shield` and `orchestrator.cacheTtls.shield` in user configs — a coordinated rename of the routing key is tracked in #1335.

User-visible effect: `totem review` output now prints `[Review]` instead of `[Shield]`. No config migration required.
