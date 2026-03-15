## Lesson — External submodules used as consumer sandboxes should be

**Tags:** git, submodules, configuration

External submodules used as consumer sandboxes should be added to project-specific ignore patterns. This prevents analysis and linting tools from incorrectly processing external code as part of the primary repository's source.
