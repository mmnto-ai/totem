## Lesson — For data structures with few fields (e.g., < 10), use type

**Tags:** typescript, zod, architecture

For data structures with few fields (e.g., < 10), use type assertions rather than Zod to avoid unnecessary dependency overhead and dynamic imports. This maintains a balance between type safety and code weight in performance-sensitive areas like the CLI.
