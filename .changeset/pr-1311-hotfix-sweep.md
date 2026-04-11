---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

1.14.1 — Hotfix sweep (#1311)

Bundled fixes for four post-1.14.0 regressions surfaced during the first day of 1.14.0 in production:

- **#1304** — `totem review` and `totem lint` were running rules against on-disk content instead of staged content when files had unstaged modifications. The rule engine now loads staged blob content via `git show :path` when a path is in the index, and reads from the filesystem only when the path is unstaged. Path containment is also hardened to reject symlinks that escape the repo root.
- **#1305** — `lance-search` predicates were failing on any field name containing a SQL keyword or dash (`source-repo`, `file-type`) because the generated `WHERE` clause lacked backtick quoting. Field identifiers are now backtick-wrapped consistently.
- **#1306** — AST engine test coverage audit found an uncovered branch in `ast-query` that silently returned an empty result set for malformed tree-sitter query strings. It now throws a descriptive error so `totem compile` can surface the broken rule instead of silently dropping it.
- **#1309** — `totem doctor` and `totem lint` were still printing the legacy `totem review --fix` hint after that flag was removed in 1.12. Updated to the current `totem review --apply` form.
