---
'@mmnto/cli': minor
---

init/hooks: SessionStart (Claude + Gemini) and post-merge managed templates also fire `totem-status refresh-obligation-store` beside `refresh-gh`, under the same primary-checkout gate / log stamp / ENOENT-silent contract, so the durable obligation store gets its session-start and post-merge moment (mmnto-ai/totem-status#127; sibling of mmnto-ai/totem#2556)

Minor rather than patch, following the two governing precedents on this same block: `48cb5208` (refresh-gh observability leg) and `3ef61fc` (which added the refresh-gh spawn, shipped as 1.109.0) both took minor.

The second verb requires a `totem-status` at slice two (commit `711f07a`) or later. An older sidecar does not reject an unknown verb — it falls through to the default dashboard, so the full status report lands in the hook log instead (measured: exit 0, ~179 KB per firing in a cohort checkout). A quiet non-zero exit for unknown verbs is an open question with the sidecar owner; the bound is named here until it closes.
