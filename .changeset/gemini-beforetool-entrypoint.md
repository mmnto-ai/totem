---
'@mmnto/cli': patch
---

fix(hooks): the distributed Gemini `BeforeTool.cjs` template gains its command entry point — registered as a command hook it previously defined a function and exited 0, so every guard in it was inert (fail-open, mmnto-ai/totem#2611). Run as `node BeforeTool.cjs` it now reads the hook-input JSON from stdin and on violation emits the structured `{"decision":"deny","reason"}` stdout decision AND exits 2 (a throw exits 1, which Gemini treats as allow-with-warning — throwing can never deny). Input the guard cannot evaluate (unparseable JSON, missing `tool_name`) is allow-with-warning with a stderr breadcrumb. `require()` of the file still yields the bare guard function. Registration/arming remains the deferred mmnto-ai/totem#2478 slice — nothing registers the hook in this change.
