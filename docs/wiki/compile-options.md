# Compile Options

The `totem compile` command translates your Markdown lessons into a deterministic `compiled-rules.json` file containing AST queries and regex patterns.

## Available Flags

- `--cloud`: Offloads the compilation process to the Totem remote build workers to save local resources and time.
- `--concurrency <N>`: Sets the number of rules to compile in parallel when running locally.
- `--force`: Bypasses the cache and forces a full recompilation of all lessons.
- `--from-cursor`: Scans for `.cursor/rules/*.mdc`, `.cursorrules`, and `.windsurfrules` files. It parses frontmatter and plain text rules, immediately compiling them into deterministic Totem rules via the LLM pipeline.
