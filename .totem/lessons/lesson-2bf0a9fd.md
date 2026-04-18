## Lesson — Cover all dynamic evaluation constructors

**Tags:** security, javascript
**Scope:** packages/pack-agent-security/test/**/*.ts, !**/*.test.*, !**/*.spec.*

Rules forbidding dynamic code must target both 'new Function()' and the bare 'Function()' constructor, as both facilitate arbitrary code execution.
