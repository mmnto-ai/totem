---
'@mmnto/cli': minor
---

feat(cli): hooksCommand exit-code contract + managed session-hook bounded drift-repair.

- **Exit-code contract test block (mmnto-ai/totem#2410 slice 2):** a dedicated falsifying test locks `totem hook install`'s 0/1 semantics (Tenet 19) — exit 0 ⟺ {fresh install, already-current, bounded drift-repair (git hook AND session hook), declared skips (not-a-git-repo, hook-manager-detected)}, exit ≠0 ⟺ a genuine hook-write failure propagates, and `--check` is exactly 0/1 on all-present-with-marker vs missing/markerless.
- **Managed session-hook regeneration (slice 3):** the marker-headed whole-file `.claude/hooks/*.cjs` + `.gemini/hooks/*.js` artifacts gain the mmnto-ai/totem#2406 bounded-ownership end marker (`// [totem] end auto-generated`) and are now drift-repaired in place by `totem hook install` via the new `MANAGED_SESSION_HOOKS` roster (regenerate-only-if-present — creation stays with `totem init`; a user-owned file carrying no Totem marker is never touched, even under `--force`). `totem init`'s `scaffoldFile` picks up the same bounded self-repair (new `refreshed` action).
- **Truthful messages:** a bare drift-repair now prints `Drift-repaired … (totem-owned bounded region)`; `Force-overwritten …` prints only when `--force` was actually passed (was previously the misleading force text on every in-place repair). The `--check` failure remedy now names `totem hook install` (not the deprecated `totem hooks`).

Consumer-impact: existing marker-headed session hooks (`.claude/hooks/*.cjs`, `.gemini/hooks/*.js`) each need one `totem hook install --force` after upgrade to adopt the end marker, after which bare `totem hook install` self-repairs their drift (identical to the shipped mmnto-ai/totem#2406 git-hook migration).
