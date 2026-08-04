## Lesson — Avoid checkpoint markers as lock proxies

**Tags:** sync, lock, checkpoint
**Scope:** packages/core/src/ingest/pipeline.ts

Using checkpoint markers to detect active syncs is unreliable because long-running incremental syncs may not write these markers. Always rely on bounded lock acquisition or explicit state checks instead of proxy files.
