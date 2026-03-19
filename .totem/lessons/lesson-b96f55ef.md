## Lesson — When reverting problematic compiled rules, identify

**Tags:** linting, version-control, automation

When reverting problematic compiled rules, identify and blocklist untracked lesson hashes that are not yet in the active rule set. This prevents the compiler from re-generating the same regressions during forced recompilation attempts.
