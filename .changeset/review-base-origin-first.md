---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

fix(core): `totem review`/`lint` branch-vs-base diff prefers `origin/<base>` over a stale local ref, so false-CRITICALs can't false-block the push gate (mmnto-ai/totem#2054 / mmnto-ai/totem#2055).

`getGitBranchDiff` tried the local `<base>` ref before `origin/<base>`. On a feature-branch workflow the local default branch is never checked out, so it is stale (or absent); `git diff <stale-base>...HEAD` then re-includes already-merged code as "new" — manufacturing false-CRITICAL review findings that block the push gate (the review hook will not stamp on a FAIL) and inflating the diff into the 50k truncation cliff.

It now prefers the remote-tracking `origin/<base>` (the current merged base), falling back to the local ref only when origin is absent (offline / no-remote / shallow CI). Three-dot `...HEAD` already resolves merge-base, so this stays a local, no-network change — no fetch added. Fixes `review`, `lint`, and `verify-badges` through the shared helper. Part of the gate-correctness cluster (mmnto-ai/totem#2055).
