## Lesson — Dynamic imports prevent heavy dependencies from degrading

**Tags:** cli, architecture, performance
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Dynamic imports prevent heavy dependencies from degrading the CLI's global startup latency. Restricting these imports to command entry points ensures that utility and adapter layers remain straightforward while the CLI remains responsive.
