# Language Packs

Totem dynamically detects your project ecosystem during `totem init` and installs additive language packs. Monorepos containing multiple languages will receive multiple corresponding packs.

## Available Packs

- **Python:** 8 baseline rules.
- **Rust:** 8 baseline rules.
- **Go:** 8 baseline rules.
- **TypeScript/JavaScript:** Included in the Universal Baseline.

## Compilation Requirement

Non-JS baseline packs are shipped without pre-compiled rules. After initialization, you must run `totem compile` to generate the deterministic AST/regex rules for these ecosystems.
