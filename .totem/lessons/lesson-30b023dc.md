## Lesson — When extracting detection/scanning functions from a God

**Tags:** refactoring, architecture, circular-deps, god-object

When extracting detection/scanning functions from a God Object into a separate module, hook installers that depend on scaffolding functions in the original file create circular imports. Move the detection logic and constants without the hook installer fields, then wire up the hooks at module scope in the orchestrator file via post-import assignment. This avoids circular dependencies while keeping the public API and test imports unchanged.
