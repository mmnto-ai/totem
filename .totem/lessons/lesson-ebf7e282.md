## Lesson — Distinguish Rust lifetimes from char literals

**Tags:** rust, parsing, lexing
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Treating Rust lifetime ticks as character literals can cause brace-matching scanners to swallow braces and over-extend spans, leading to silent over-exemption of lint rules.
