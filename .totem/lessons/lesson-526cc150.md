## Lesson — Ensure filesystem locks are released within finally blocks

**Tags:** nodejs, robustness, concurrency

Ensure filesystem locks are released within `finally` blocks rather than just after a successful `await` or inside a `catch`. Manual release management is fragile and can leak locks if an error occurs between the critical action and the release call, causing subsequent operations to hang.
