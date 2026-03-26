---
tags: ["architecture", "totem"]
lifecycle: nursery
---

## Lesson — Avoid using live suppression markers like totem-context:

**Tags:** architecture, totem

Avoid using live suppression markers like `totem-context:` in files that are already globally excluded from a rule's scope. Use standard comments for explanation instead; this prevents the suppression engine from potentially masking other unrelated rules that might apply to the same lines.
