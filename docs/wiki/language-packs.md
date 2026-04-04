# Language Packs

Totem provides ecosystem-specific language packs containing baseline lessons and pre-compiled rules for TypeScript, Node.js, Shell, Python, Rust, and Go.

When you run `totem init`, Totem auto-detects your ecosystem and automatically merges the relevant language packs into `.totem/lessons/baseline.md` and `.totem/compiled-rules.json`.

## The Pack Structure

Totem currently ships with 50 baseline rules distributed across the following packs:

- **Universal TS/JS (23 rules)** — Always included.
- **TypeScript (9 rules)** — Included when the `javascript` ecosystem is detected. Sourced from `@typescript-eslint/strict`.
- **Node.js Security (8 rules)** — Included when the `javascript` ecosystem is detected. Sourced from OWASP Node.js security patterns.
- **Shell/POSIX (10 rules)** — Always included (totem hooks are shell scripts). Sourced from ShellCheck and POSIX spec.
- **Python (8 rules)**, **Rust (6 rules)**, **Go (2 rules)** — Included when their respective ecosystems are detected.

This ensures you start with a highly relevant, battle-tested set of constraints tailored to your stack's specific footguns.
