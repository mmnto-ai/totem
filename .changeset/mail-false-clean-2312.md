---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

Fix `totem mail` rendering a false-clean inbox from a subdirectory, and stop it certifying an empty inbox it cannot derive (mmnto-ai/totem#2312; Tenet 4 fail-loud). Two halves:

- **Subdirectory workspace derivation.** Run from a SUBDIRECTORY of a repo (e.g. `.totem/orchestration/<seat>/processed/`), `pollMail` used `path.resolve(process.cwd())` as the repo root and `path.dirname(repoRoot)` as the workspace — both garbage from a subdir, so the outbox scan found nothing and the poll reported a clean inbox at exit 0. It now walks UP from the start dir to the nearest ancestor carrying a `.totem/` marker OR a `.git` entry (dir OR file — linked worktrees use a `.git` file), then derives the workspace as that root's parent. `@mmnto/totem` gains `findTotemRepoRootSync(start)` (pure fs, no git spawn), the sibling of `findRepoRootSync`. A marker-less start dir falls back to the given dir (bare-fixture behavior preserved); explicit `--workspace` / `TOTEM_WORKSPACE` overrides are untouched. `totem ecl-gc` (`eclGc` prune + `eclCompact`) shared the same cwd-fragile seam and now walks up through the same helper.

- **NOT-DERIVED verdict on unresolved self, with a new exit contract.** When no self agent resolves (`selfAgents.source: 'none'`), an empty inbox asserts nothing — every directed dispatch is filtered out, and even a surviving broadcast match cannot certify directed-mail absence. The text output now renders `Inbox state NOT DERIVED — no self agent resolved; …` instead of the clean-inbox (or unread-list) verdict, keeping the Workspace / Self agents / warning lines.

  **NEW EXIT CONTRACT:** `totem mail` now exits **2** when no self agent resolves (was: exit **0** with a clean-looking verdict), mirroring its `totem ecl-gc` sibling's unresolvable-self class — the plain poll must not be softer. A genuine clean inbox with a RESOLVED self stays exit 0. `--json` still emits the full result to stdout on the unresolved arm (it already exposes `source: 'none'` + warnings) AND exits 2. `pollMail` keeps its never-throws contract and return shape; the CLI wrapper maps the data to the exit code.
