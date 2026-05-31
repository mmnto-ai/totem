---
'@mmnto/cli': minor
'@mmnto/totem': patch
---

feat(cli): `totem orient` — derive session orientation from primitives (zero LLM)

New `totem orient [--json]` command (WS2, #2044). A deterministic sensor that
derives "what's parked / in flight / open" from live `gh` / `git` / fs
primitives — `.totem/freeze.json` parked entries, open PRs (with `[draft]`),
the in-flight GH Project board, epics + sub-issues (with a cross-repo parent
guard), other open issues, and a one-line index-freshness pointer — each line
citing its primitive. Adds one new derived signal: a board↔issue **coherence**
flag (an active board card whose issue is closed/absent = drift), computed by a
pure predicate from the board + open-issue primitives orient already fetched
(no extra `gh` call). Sibling to `totem triage` (LLM synthesis on top); they
compose, not duplicate.

Honest by construction: every section is its value or an `{ error }` envelope —
nothing silently omitted (Tenet 4); "not yet synced" / "no board configured"
are explicit absences, not errors (Tenet 14); the footer states the output is a
snapshot/cache, not a source (Tenet 20). Takes no embedding/LanceDB path, so it
runs green when `@google/genai` is absent.

Consumer-safety: owner is derived from `gh repo view`; the GH Project number is
read from the new optional `orient.projectNumber` field in `totem.config.ts`
(env `TOTEM_ORIENT_PROJECT` overrides last). With no project configured the
board section is an honest absence — the cohort's board is not baked in.

Core (`@mmnto/totem`): adds the optional `orient.projectNumber` config field
(`OrientConfigSchema`).
