## Lesson — Filter upgrade diagnostics by rule engine

**Tags:** regex, ast-grep, telemetry
**Scope:** packages/cli/src/commands/doctor.ts

Diagnostics targeting regex-to-AST upgrades must explicitly filter for rules using the 'regex' engine. AST-based rules often lack context telemetry (landing in 'unknown'), and including them in non-code ratio checks leads to false positive flags for rules that are already structural.
