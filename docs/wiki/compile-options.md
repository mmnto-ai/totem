# Compile Options

The `totem compile` (and `totem lesson compile`) command transforms your Markdown lessons into deterministic rules.

## Key Flags
- `--cloud`: Offloads the compilation process to the Totem cloud workers for faster processing without local LLM setup.
- `--concurrency <n>`: Compiles multiple lessons in parallel (default: 4).
- `--force`: Forces recompilation of all lessons, bypassing the cache.
- `--from-cursor`: Imports and compiles rules from existing `.cursor/rules/*.mdc` files into Totem's engine.

**Example Usage:**
```bash
totem compile --cloud --concurrency 8
```
