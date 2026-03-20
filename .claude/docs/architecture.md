# Architecture Context

## Monorepo Structure

- `packages/core` — LanceDB store, compiler, rule engine, lesson linter
- `packages/cli` — CLI commands (lint, shield, spec, compile, docs, extract)
- `packages/mcp` — MCP server (search_knowledge, add_lesson, verify_execution)

## Index Partitions

Partitions in `totem.config.ts` map logical names to path prefix arrays:

```typescript
partitions: {
  core: ['packages/core/'],
  cli: ['packages/cli/'],
  mcp: ['packages/mcp/'],
}
```

Pass partition names via the `boundary` parameter on `search_knowledge`.

## Key Patterns

- **3-Layer Gate:** suggestion (CLAUDE.md) → fast path (MCP verify) → guarantee (pre-push hook)
- **Pipeline 1:** lessons with `**Pattern:**` fields compile deterministically (zero LLM)
- **Linked indexes:** `totem link` connects repos. `.strategy/` is our linked strategy repo.
- **Lesson linter:** `totem lint-lessons` validates Pipeline 1 metadata before compilation

## Rule Engines

- `regex` — pattern matching (majority of rules)
- `ast` — Tree-sitter S-expressions
- `ast-grep` — compound rules with YAML configs

## Test Suite

- 1,047+ tests across core (411) + cli (626) + mcp (9)
- Cross-platform CI: ubuntu, windows, macos
