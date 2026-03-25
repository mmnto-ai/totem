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

## Capability Tiers

Totem operates in three tiers that map directly to architecture components:

| Tier        | Requires AI    | Architecture mapping                                                                                                                                      |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enforce** | No             | `totem lint` runs compiled regex/AST rules via the rule engine. Pre-push hook gates CI. Fully deterministic, offline, fast.                               |
| **Learn**   | Yes (one-time) | `totem extract` + `totem compile` use an LLM to author rules from PR reviews and lessons. AI at authoring time only — the compiled output is static JSON. |
| **Review**  | Yes (per-push) | `totem shield` sends diffs through the three-stage LLM pipeline (file classifier, hybrid diff filter, Zod-validated findings). Real-time, context-aware.  |

The Enforce tier is the moat: once rules are compiled, the AI is gone. The Learn tier is a one-time cost per lesson. The Review tier is opt-in and additive — projects that need zero-LLM guarantees can run Enforce alone.

## Rule Engines

- `regex` — pattern matching (majority of rules)
- `ast` — Tree-sitter S-expressions
- `ast-grep` — compound rules with YAML configs

## Test Suite

- Over 1,000 tests across the core, cli, and mcp packages
- Cross-platform CI: ubuntu, windows, macos
