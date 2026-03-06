---
'@mmnto/totem': minor
---

feat: add heading hierarchy breadcrumbs to MarkdownChunker labels

- Chunk labels now include full heading hierarchy (e.g. "Parent > Child") instead of just the nearest heading (#127)
- Improves retrieval context quality for `totem spec` and `totem shield` outputs
- Matches breadcrumb pattern already established in SessionLogChunker
