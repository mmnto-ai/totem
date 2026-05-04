## Lesson — Prefer path.join for path security

**Tags:** security, node.js
**Scope:** packages/core/src/strategy-resolver.ts

Use path.join instead of path.resolve when combining base paths with potentially untrusted inputs. path.resolve can treat an absolute-looking input as a new root, enabling path injection vulnerabilities.
