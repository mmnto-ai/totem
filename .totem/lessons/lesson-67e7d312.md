## Lesson — Restrict dynamic imports to CLI command entry points

**Tags:** security, architecture, dependency-management

Restrict dynamic imports to CLI command entry points to avoid security scanner noise while maintaining a clean dependency graph. Utility and adapter layers should use standard top-level imports to ensure structural clarity and pass automated code scanning audits.
