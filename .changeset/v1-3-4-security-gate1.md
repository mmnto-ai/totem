---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

### Security & Compiler Hardening

- `totem link` now requires explicit consent ("I understand") before creating cross-trust-boundary bridges. Bypass with `--yes` for CI/CD.
- Shell orchestrator process termination uses process groups on Unix (prevents zombie processes)
- SECURITY.md expanded with threat model, audit results, and Totem Mesh risks
- Gate 1 (Proposal 184): Compiled rules now default to `severity: 'warning'` when LLM omits severity, preventing the #1 compiler regression
- Added `severity` field to `CompilerOutputSchema`
