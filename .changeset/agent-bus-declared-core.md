---
'@mmnto/totem': minor
---

feat(parity): sense `manifestation: declared` (Prop 305 §3 agent-bus) in the parity detector.

Adds `detectDeclaredContract` (+ `parseDeclarationMarker`), a declaration-surface sensor: it reads a repo-authored `<!-- totem:<token> role="…" seat="…" -->` HTML-comment marker and returns `pass` when a well-formed role→seat binding is present, or an honest-absent `skip` (never `warn`/`fail`) when the file or marker is absent, or when the marker is missing `role`/`seat` (the why-not names the missing attribute, Tenet 4). The sensor claims DECLARATION PRESENCE ONLY — never duty execution (adherence-class, Tenet 19 / Prop 305 §3.5). `'declared'` is added to `PARITY_MANIFESTATIONS` so the routing edge recognizes the rung. The marker regex is linear (ReDoS-safe), mirroring `parseForkMarker`.

Consumer-impact: new additive sensing on the manifestation ladder; no behavior change for repos without the marker (they stay honest-absent skip). No breaking changes.
