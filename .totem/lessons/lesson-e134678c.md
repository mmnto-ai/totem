## Lesson — When scanning directories for feature detection

**Tags:** nodejs, filesystem, error-handling

When scanning directories for feature detection in monorepos, explicitly handle known missing paths (like ENOENT) while logging or rethrowing other system errors. Swallowing all errors in a catch block can mask permission issues or structural problems that prevent correct tool configuration.
