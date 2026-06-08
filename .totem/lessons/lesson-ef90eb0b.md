## Lesson — Decouple attestation dates from status verdicts

**Tags:** cli, architecture, metadata
**Scope:** packages/cli/src/commands/doctor-parity.ts

Attestation dates should be treated as informational metadata and decoupled from status verdict logic to ensure that the presence or absence of a date does not inadvertently trigger failures.
