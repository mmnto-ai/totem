## Lesson — A null author is a deleted account, a human; an author without __typename or login is unreadable

**Tags:** github-api, identity
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

When classifying a thread comment's author as bot or human, treat author: null as a HUMAN reply (a deleted account; the resolve-threads rule) so a resolved finding it answers still discharges, but treat an author OBJECT missing __typename or login as an unreadable thread that fails closed. The two shapes are different facts: null is a known GitHub answer, a malformed object is a read that did not derive.
