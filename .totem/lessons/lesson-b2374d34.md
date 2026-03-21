## Lesson — Implementing simplified glob matching logic in auxiliary

**Tags:** globbing, architecture, consistency

Implementing simplified glob matching logic in auxiliary scripts creates behavioral drift compared to the core engine's enforcement. Delegating to a shared implementation ensures that maintenance audits accurately reflect production behavior regarding negations and complex patterns.
