---
'@mmnto/cli': patch
---

Ship the Gemini CLI session briefing as `.gemini/hooks/SessionStart.cjs` instead of `.js` to stop a silent fail-open (the defect reported on mmnto-ai/totem#2488), closing the scope-out the BeforeTool fix (mmnto-ai/totem#2481) deliberately left open.

The distributed hook body is CommonJS (top-level `require('child_process')` for the `totem describe` / `totem orient --session` briefings). In a consumer repo whose `package.json` declares `"type": "module"`, Node resolved the bare `.js` as ESM and threw `ReferenceError: require is not defined` before the hook emitted anything — and Gemini CLI treats a crashed hook as a non-fatal warning, so session-start context injection fail-opened silently (the agent booted cold while the consumer believed it had been briefed). A `.cjs` file is CommonJS regardless of the consumer's package `type`, mirroring the load-bearing `.cjs` extension on the Claude-side session hooks and on the Gemini write-time guard.

`totem hook install` (which the `prepare` wrapper invokes on every install) and `totem init` now migrate an upgraded consumer: the legacy bounded totem-owned `.gemini/hooks/SessionStart.js` is removed and the `.cjs` successor materialized, under the same ownership gate as the BeforeTool migration — a user-owned file that merely shares the name is skipped untouched, and a drifted-unbounded one is declined until `--force`. There is no registration seam to migrate: `totem init` emits no `.gemini/settings.json` SessionStart command (Gemini CLI discovers the session hook by path), so the rename is the whole fix. `totem eject` removes both the `.cjs` and the legacy `.js`. `totem doctor --parity` now checks the `.cjs` path; an un-migrated consumer reads as honest-absent `skip`, never as drift.
