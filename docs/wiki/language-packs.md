# Language Packs

Totem provides ecosystem-specific language packs containing baseline lessons and pre-compiled rules for Python, Rust, and Go.

When you run `totem init`, Totem auto-detects your ecosystem (by looking for `requirements.txt`, `Cargo.toml`, or `go.mod`) and automatically merges the relevant language pack into your `.totem/lessons.md` and `compiled-rules.json`.

This ensures you start with a highly relevant, battle-tested set of constraints tailored to your stack's specific footguns.
