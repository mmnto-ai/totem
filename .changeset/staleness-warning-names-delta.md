---
'@mmnto/cli': patch
---

fix(lint): compile-manifest staleness warning names the changed/added/removed lessons (capped) with last-commit provenance instead of a generic line

`totem lint`'s non-blocking staleness advisory previously printed one fixed sentence that named nothing. It now diffs the lesson corpus against the commit that last wrote `compile-manifest.json` and reports which lessons changed / were added / were removed since the last compile — up to 5 by filename with their change kind, then "…and K more", each carrying the last-touching commit short-sha + author (one `git log -1` per named file via the shared safe git-exec helper). A lesson with no commit history renders `(untracked)`, distinguishing the mmnto-ai/totem#2113 class. The check stays inside its never-crash try/catch, degrades to an mtime-vs-`compiled_at` fallback when git has no anchor, and skips provenance above 500 lesson files so the naming logic never paces the lint hot path.

Consumer-impact: warning TEXT change only — no behavior/exit-code change. The first line keeps the stable `Compile manifest is stale` prefix, so any consumer matching on that prefix (unlikely — it is a stderr advisory) keeps working; the remediation still points at `totem lesson compile`.
