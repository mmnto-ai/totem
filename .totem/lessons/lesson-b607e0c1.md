## Lesson — Exported configuration structures like command groups

**Tags:** typescript, architecture

Exported configuration structures like command groups should use ReadonlySet or readonly arrays to prevent accidental runtime mutations. This ensures that help output remains consistent and cannot be silently corrupted by other modules.
