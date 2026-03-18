## Lesson — When parsing diff --git headers, extract the destination

**Tags:** git, regex, cli

When parsing `diff --git` headers, extract the destination (`b/`) path and handle quoted strings to correctly support renames and filenames with spaces. Relying on the `a/` path or failing to account for quotes will cause ignore patterns and file-specific logic to fail silently.
