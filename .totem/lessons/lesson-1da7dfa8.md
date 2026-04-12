## Lesson — Differentiate format flags across CLI commands

**Tags:** cli, dx
**Scope:** packages/cli/src/index.ts

The `--format` flag is exclusive to `totem lint`, while other commands use `--json` for scripting to ensure command-specific accuracy and avoid invalid flag errors.
