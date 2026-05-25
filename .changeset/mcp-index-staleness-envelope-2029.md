---
'@mmnto/mcp': minor
---

Surface knowledge-index freshness in MCP envelopes (mmnto-ai/totem#2029, docs-drift Mech C).

- `describe_project` rich state gains an `indexState: { lastSyncAt, staleness }` field on `RichProjectStateSchema`. The field is required when `includeRichState: true`; values are null on lite-tier configurations and pre-first-sync state (honest absence per Tenet 14).
- `search_knowledge` responses prepend a self-closing `<index-meta lastSyncAt="..." staleness="..." />` envelope above the existing `<knowledge>` block. Null state emits `<index-meta status="no-index" />`. The envelope is always present on non-error responses so callers can route on freshness without re-deriving it.
- A `<totem_system_warning>` block prepends to `search_knowledge` responses when the corpus is more than 7 days stale, prompting the agent to run `totem sync` before trusting results.

Source of truth is `.totem/cache/index-meta.json.lastSync` written on every successful `runSync`, with `.totem/index-manifest.json.writtenAt` as a fallback. Staleness strings use a human-readable relative-time format (`'just synced'`, `'5 minutes ago'`, `'3 hours ago'`, `'STALE: 14 days ago'`).

Per-result `indexedAt` is intentionally out of scope for v1: LanceDB rows do not currently carry per-row sync timestamps, so populating a per-result field from the constant manifest value would be fake-presence data.
