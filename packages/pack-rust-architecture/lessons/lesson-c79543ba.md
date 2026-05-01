---
tags: ['rust', 'const-assertions', 'tuning', 'simulation']
lifecycle: nursery
---

## Lesson — Tuning constants that feed runtime assert!

**Tags:** rust, const-assertions, tuning, simulation

Tuning constants that feed runtime `assert!` guards (e.g., jitter bounds, radius caps) should also be protected by `const` assertions at the declaration site. A runtime assert only fires when the code path executes; a `const` assertion fails at compile time, catching bad retunes before any test runs. When a runtime invariant has the form `x >= 0.0 && x <= limit`, add a matching `const _: () = assert!(X >= 0.0 && X <= LIMIT);` next to the constant definition.
