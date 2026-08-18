## Lesson — Bypass mismatched hook material during signon

**Tags:** security, session, skills
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

If injected hook material identifies a seat other than the current seat during signon, the session must discard the material and fall back to a hook-less path. This prevents consuming foreign journal or mail data and ensures seat-anchored polling integrity.
