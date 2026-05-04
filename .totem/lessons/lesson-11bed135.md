## Lesson — Always forward config to resolvers

**Tags:** architecture, dx
**Scope:** packages/cli/src/commands/doctor.ts, packages/mcp/src/state-extractors.ts

Consumer functions like diagnostics or state extractors must pass the full configuration object to underlying resolvers. Bypassing the config layer prevents the system from honoring user-defined overrides in project configuration files.
