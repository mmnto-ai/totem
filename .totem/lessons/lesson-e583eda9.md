## Lesson — Validate config docs against Zod schemas

**Tags:** zod, configuration, documentation
**Scope:** docs/wiki/**/*.md, README.md

Documented configuration examples can be silently stripped by Zod if they use incorrect nesting, casing, or unsupported fields. Always verify that documentation matches the exact structure and types defined in the schema to prevent silent feature failures.
