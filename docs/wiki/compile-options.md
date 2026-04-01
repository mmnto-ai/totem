# Compile Options

The `totem compile` (and `totem lesson compile`) command transforms your Markdown lessons into deterministic rules.

## Key Flags
- `--cloud <url>`: Offloads the compilation process to a cloud endpoint for parallel fan-out.
- `--concurrency <n>`: Compiles multiple lessons in parallel (default: 5).
- `--force`: Forces recompilation of all lessons, bypassing the cache.
- `--from-cursor`: Ingests `.cursorrules`, `.windsurfrules`, and `.cursor/rules/*.mdc` files as lessons and compiles them into Totem rules.

**Example Usage:**
```bash
totem compile --cloud https://your-worker.example.com/compile --concurrency 8
```
