# Baseline Rules

Totem ships with a **Universal Baseline** of curated architectural invariants mined from elite engineering teams. When you run `totem init`, these baseline rules are automatically seeded into your project.

Baseline rules provide immediate value by catching common structural traps before you even write your first custom lesson.

## Language-Specific Rules

Totem includes language-specific baselines for:

- **Python** (e.g., FastAPI, Django conventions)
- **Rust** (e.g., Tokio, Serde patterns)
- **Go** (e.g., Goroutine leaks, context propagation)
- **TypeScript/Node** (e.g., avoiding native `child_process`, proper error handling)

For more information on how these are merged, see [Language Packs](language-packs.md).
