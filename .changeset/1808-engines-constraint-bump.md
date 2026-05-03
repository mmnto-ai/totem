---
'@mmnto/pack-rust-architecture': patch
'@mmnto/pack-agent-security': patch
---

**Fix `engines['@mmnto/totem']` constraint floor — `^1.25.0` → `^1.26.0`.**

GCA HIGH catch on the auto-generated Version Packages PR (#1808). The engines-field reader (`pack-manifest-writer.ts:readEngineRange`) ships in `@mmnto/totem@1.26.0`. Engines pre-1.26.0 read `peerDependencies['@mmnto/totem']` and would silently treat these packs as `not-a-pack` (the engines field is invisible to them). Declaring compatibility with `^1.25.0` was technically incorrect — a 1.25.0 engine cannot satisfy these packs even though caret-semver would let it match.

Tightening the floor to `^1.26.0` makes the constraint match actual runtime compatibility. Fixed-group co-versioning makes this a documentation / safety-rail correction in practice (consumers pinned to a 1.26.x pack pull in the matching 1.26.x engine via the cohort), but the declared range should reflect reality.

No code change. Constraint-only tightening.
