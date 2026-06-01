---
'@mmnto/cli': patch
---

`totem orient` session-start auto-injection (WS2 PR-2): add programmatic `deriveOrientReport` and `renderOrientForSession` exports so the SessionStart hook injects derived, bounded orientation (parked subsystems, open PRs, board↔issue coherence drift, a counts pointer) into the session payload.
