# Compile Options

The `totem compile` (and `totem lesson compile`) command transforms your Markdown lessons into deterministic rules.

## Key Flags

- `--cloud <url>`: Offloads the compilation process to a cloud endpoint for parallel fan-out. (Note: Cloud compile is still routed to Gemini until #1221 ships).
- `--concurrency <n>`: Compiles multiple lessons in parallel (default: 5).
- `--force`: Forces recompilation of all lessons, bypassing the cache.
- `--from-cursor`: Ingests `.cursorrules`, `.windsurfrules`, and `.cursor/rules/*.mdc` files as lessons and compiles them into Totem rules.
- `--upgrade <hash>`: Targets one rule by hash (full or short prefix), evicts only that rule from the cache (preserves `createdAt` metadata), recompiles through Sonnet with a telemetry-driven directive, and replaces the rule. Rejects `--cloud` (not supported) and `--force` (scoped eviction makes `--force` redundant and dangerous).

**Example Usage:**

```bash
totem compile --cloud https://your-worker.example.com/compile --concurrency 8
```
