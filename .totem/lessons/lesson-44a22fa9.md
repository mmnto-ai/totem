## Lesson — Merge global options in subcommands

**Tags:** cli, commander, options
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Commander subcommands fail to detect flags also defined at the program level unless optsWithGlobals() is used to merge option scopes.
