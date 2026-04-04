## Lesson — Exclude test files from XSS rules

**Tags:** security, testing, javascript
**Scope:** packages/cli/src/assets/baseline-nodejs-security.ts

Rules targeting dangerous sinks like innerHTML should exclude test files to allow for legitimate testing of sanitization logic or error handling.
