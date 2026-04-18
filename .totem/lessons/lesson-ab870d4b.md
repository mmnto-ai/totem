## Lesson — Include low-level socket APIs in network rules

**Tags:** security, nodejs
**Scope:** packages/pack-agent-security/test/**/*.ts

Security rules for network exfiltration must cover low-level constructors like `net.Socket` and its `connect` method in addition to high-level APIs like `fetch` or `axios` to prevent bypasses.
