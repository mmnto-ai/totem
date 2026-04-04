# Baseline Rules

Totem ships with a **Universal Baseline** of curated architectural invariants mined from elite engineering teams. When you run `totem init`, these baseline rules are automatically seeded into your project.

Baseline rules provide immediate value by catching common structural traps before you even write your first custom lesson.

## Language-Specific Rules

Totem includes language-specific baselines (50 rules total) for:

- **Universal TS/JS** (e.g., architectural invariants)
- **TypeScript** (e.g., strict type checking, avoiding `any`)
- **Node.js Security** (e.g., preventing shell injection, hardcoded secrets)
- **Shell/POSIX** (e.g., POSIX compliance for Git hooks, avoiding bashisms)
- **Python** (e.g., FastAPI, Django conventions)
- **Rust** (e.g., Tokio, Serde patterns)
- **Go** (e.g., Goroutine leaks, context propagation)

For more information on how these are merged, see [Language Packs](language-packs.md).
