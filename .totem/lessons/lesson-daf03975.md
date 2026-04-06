## Lesson — Guard telemetry against unrelated execution flows

**Tags:** telemetry, architecture
**Scope:** packages/cli/src/commands/run-compiled-rules.ts

Ensure telemetry collectors are guarded by specific context checks so that unrelated execution paths (like AST rules) do not pollute 'unknown' metric buckets intended for other flows.
