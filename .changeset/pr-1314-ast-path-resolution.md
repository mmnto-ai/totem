---
'@mmnto/cli': patch
---

Resolve non-staged AST paths against repo root, not cwd (#1314)

`totem review` was resolving AST engine file paths relative to the current working directory instead of the repo root when evaluating non-staged files, causing false misses for any invocation from a subdirectory. The resolver now consistently anchors against the repo root for both staged and non-staged paths. Fixes #1312.
