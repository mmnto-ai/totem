## Lesson — Use surgical cache eviction for targeted updates

**Tags:** caching, performance
**Scope:** packages/cli/src/commands/compile.ts

To re-compile a single item in a cached batch process, surgically delete the target hash from the 'existing' and 'non-compilable' sets before the loop. This allows the target to be treated as a new item while allowing all other items to hit the cache, maintaining performance.
