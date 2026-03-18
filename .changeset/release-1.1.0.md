---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
---

Release 1.1.0 — Tier 2 AST engine, cross-totem queries, and totem explain.

### Highlights

- **Tier 2 AST engine**: Compiled rules now support Tree-sitter S-expression queries alongside regex. Enables structural rule matching that regex alone can't express.
- **Cross-totem queries**: New `linkedIndexes` config lets `totem spec` query knowledge from other totem-managed directories (e.g., strategy repos, design docs) alongside the primary project index.
- **totem init --bare**: Zero-config initialization for non-code repositories — notes, docs, ADRs, infrastructure configs. No package.json required.
- **totem explain**: Look up the full lesson behind any compiled rule violation. Supports partial hash prefix matching. Zero LLM, instant.
- **TODO guardrail rules**: 3 new baseline rules catch `// TODO: implement` stubs, `throw new Error("Not implemented")`, and empty catch blocks. Baseline now ships 15 pre-compiled rules.
- **Dimension mismatch detection**: `totem sync` writes `index-meta.json`. Switching embedding providers without rebuilding the index now throws a clear error instead of silently returning garbage results.
- **Compiled rules reverted to curated set**: The 147 hand-audited rules are preserved. Blind recompilation with Flash produced regressions — compiler improvements tracked in #670.
