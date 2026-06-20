---
'@mmnto/totem': patch
---

fix(lint): `// totem-context:` / `// totem-ignore` inline suppression now applies under diff-scoped lint (`totem lint --base main`), identically to full-tree lint (mmnto-ai/totem#2214).

For a multi-line construct (e.g. a `catch_clause` matched by the Tenet-4 `lesson-fail-open-catch-ban` rule), the reported match line is the first _added_ line within the node's range. Under diff scope, when only a line inside the construct's body is in the diff, that reported line drifts off the construct's start line — so a correctly-positioned directive on (or immediately above) the `catch` line was missed and the rule fired anyway, pushing authors toward matcher-evasion (rewriting `catch {}` as `.catch(() => …)` to dodge the `catch_clause` matcher). The ast-grep and tree-sitter match results now carry the construct's start-line text and its preceding-line text as an explicit suppression anchor; suppression checks both the matched line and that anchor, so a directive on the construct line suppresses regardless of which body line landed in the diff. Reported violation locations are unchanged.
