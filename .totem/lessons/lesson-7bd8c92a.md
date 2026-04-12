## Lesson — Ensure SARIF parity for standalone binaries

**Tags:** ci-cd, cli
**Scope:** packages/cli/src/index-lite.ts

The `totem-lite` binary must support the same `--format sarif` flag as the main CLI to provide consistent CI integration in environments without Node.js.
