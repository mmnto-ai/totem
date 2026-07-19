---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

record bounded, DLP-safe invocation evidence for CLI fallbacks and terminal provider failures (#2452 slice B)

Successful configured-shell and fallback runs can now include ordered execution-attempt provenance in their run artifacts. Terminal invocation failures are classified and written to a distinct content-addressed failure ledger, allowing callers to diagnose authentication, quota, model, spawn, exit, and timeout failures without parsing error prose or persisting unbounded provider output.
