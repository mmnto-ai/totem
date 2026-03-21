## Lesson — Re-injecting a manifest of tools, commands, and project

**Tags:** prompt-engineering, context-management, hooks

Re-injecting a manifest of tools, commands, and project partitions via a `PostCompact` hook prevents the agent from losing situational awareness after context pruning. This pattern ensures project-specific capabilities remain in the agent's active memory during long-running sessions while staying within a strict token budget (e.g., <250 tokens) to avoid immediate re-compression.
