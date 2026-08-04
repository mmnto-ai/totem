## Lesson — Omit windowsHide with detached processes

**Tags:** windows, node, process
**Scope:** packages/cli/src/commands/init-templates.ts

On Windows, the CREATE_NO_WINDOW flag is ignored when a process is spawned with DETACHED_PROCESS. Consequently, setting windowsHide: true is redundant and inert when detached: true is enabled.
