## Lesson — When deferring a bot optimization suggestion as "premature"

**Tags:** deferred-optimization, code-review, process, trap

When deferring a bot optimization suggestion as "premature" (e.g., combining regex into one pass for a single-entry array), document the trigger condition for when it becomes worthwhile. Without this, deferred patterns accumulate silently and are rediscovered from scratch later. Tag deferred optimizations with a concrete threshold: "revisit when list exceeds N entries."
