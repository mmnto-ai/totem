---
'@mmnto/cli': patch
---

Ship the Gemini CLI write-time guard as `.gemini/hooks/BeforeTool.cjs` instead of `.js` to stop a silent fail-open (the defect reported on mmnto-ai/totem#2481).

The distributed hook body is CommonJS (top-level `require('child_process')`). In a consumer repo whose `package.json` declares `"type": "module"`, Node resolved the bare `.js` as ESM and threw `ReferenceError: require is not defined` before it could read the tool call — and Gemini CLI treats a crashed hook as a non-fatal warning, so the write-time guard fail-opened silently (the consumer believed it was armed while it never evaluated anything). A `.cjs` file is CommonJS regardless of the consumer's package `type`, mirroring the load-bearing `.cjs` extension on the Claude-side session hooks.

`totem hook install` (which the `prepare` wrapper invokes on every install) and `totem init` now migrate an upgraded consumer: the legacy bounded totem-owned `.gemini/hooks/BeforeTool.js` is removed and the `.cjs` successor materialized, and an existing `.gemini/settings.json` BeforeTool command pointing at the `.js` is rewritten to the `.cjs`. The rewrite is idempotent, fail-soft on malformed settings (user content preserved), and never creates a registration where none exists. `totem eject` removes both the `.cjs` and the legacy `.js`. `SessionStart.js` is intentionally left as-is — the slice scopes to the write-time guard.
