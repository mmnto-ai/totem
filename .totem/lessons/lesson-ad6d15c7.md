## Lesson — When a hook is intended to run unconditionally, use

**Tags:** claude-code, glob, best-practices

When a hook is intended to run unconditionally, use an explicit `**/*` glob pattern instead of an empty string. This clarifies intent for future maintainers and ensures the configuration isn't mistaken for a path-specific hook with a missing value.
