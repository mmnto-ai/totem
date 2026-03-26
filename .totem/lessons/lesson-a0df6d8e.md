---
tags: ["totem", "maintenance", "architecture"]
lifecycle: nursery
---

## Lesson — Stale totem-context: suppression markers should be

**Tags:** totem, maintenance, architecture

Stale `totem-context:` suppression markers should be converted to plain comments if a file is subsequently excluded from a rule's scope via configuration. Retaining live suppression markers on excluded files creates a 'suppression debt' that may unintentionally mask other rule violations on those same lines.
