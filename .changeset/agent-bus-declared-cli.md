---
'@mmnto/cli': minor
---

feat(doctor): `totem doctor --parity` now senses `manifestation: declared` (the `agent-bus` row).

Wires the CLI-side declaration registry (`declarationMarkersFor`, `agent-bus` → the repo's own `AGENTS.md` + the `totem:agent-bus` marker token) and routes `declared` rows to `detectDeclaredContract` before the unrecognized-manifestation guard. The `agent-bus` row now PASSes — naming the `role → seat` binding — when the repo declares a `totem:agent-bus` marker, and stays an honest-absent SKIP ("honest-absent until a repo declares") when it does not. An unknown `declared` contract id gets a registry-gap stub, mirroring an unwired capability probe. Never warns on absence.

Consumer-impact: new additive sensing surface on `totem doctor --parity`; no behavior change for repos without the marker (the row stays a skip), never affects exit codes. No breaking changes.
