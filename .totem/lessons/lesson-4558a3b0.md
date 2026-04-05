## Lesson — Pin Bun versions in CI

**Tags:** ci, bun, reproducibility
**Scope:** .github/workflows/release-binary.yml

Using 'latest' for Bun in CI workflows can lead to non-reproducible builds and unexpected breakages when the runtime releases breaking changes.
