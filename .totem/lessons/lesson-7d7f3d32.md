## Lesson — Maintain structural absence for optional fields

**Tags:** schema, typescript, architecture
**Scope:** packages/core/src/parity-manifest.ts

When mapping optional fields from raw manifests, ensure absent values remain structurally absent ('honest-absent') in the domain model to avoid fabricating provenance for missing data.
