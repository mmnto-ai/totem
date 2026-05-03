# Compile Options

The `totem lesson compile` command transforms your Markdown lessons into deterministic rules.

> **Canonical command form:** `totem lesson compile`. The shorter `totem compile` is a deprecated alias (the CLI's own `--help` output marks it as such). New documentation should use `totem lesson compile`; the `Entities:` section of `totem --help` lists `rule`, `lesson`, `exemption`, `config` as the canonical command groupings.

## Key Flags

- `--cloud <url>`: Offloads the compilation process to a cloud endpoint for parallel fan-out. (Note: Cloud compile is still routed to Gemini until #1221 migrates the cloud worker to Sonnet; local compile is the golden path and routes to Sonnet 4.6.)
- `--concurrency <n>`: Compiles multiple lessons in parallel (default: 5).
- `--export`: Re-exports compiled rules to AI tool config files per the `exports` map in `totem.config.ts`.
- `--force`: Forces recompilation of all lessons, bypassing the cache.
- `--from-cursor`: Ingests `.cursorrules`, `.windsurfrules`, and `.cursor/rules/*.mdc` files as lessons and compiles them into Totem rules.
- `--upgrade <hash>`: Targets one rule by hash (full or short prefix), evicts only that rule from the cache (preserves `createdAt` metadata), recompiles through Sonnet with a telemetry-driven directive, and replaces the rule. Rejects `--cloud` (not supported) and `--force` (scoped eviction makes `--force` redundant and dangerous).
- `--refresh-manifest`: No-LLM primitive that recomputes the manifest's `output_hash` after manual edits to `compiled-rules.json`. Backs the atomic `totem lesson archive` command.

**Example Usage:**

```bash
totem lesson compile --concurrency 8 --export
```
