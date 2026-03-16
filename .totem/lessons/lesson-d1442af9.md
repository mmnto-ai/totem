## Lesson — Material updates to system prompts should be accompanied

**Tags:** prompts, versioning, reflex

Material updates to system prompts should be accompanied by an explicit version increment to ensure cached prompt states are invalidated. This prevents the persistence of stale logic or incorrect command definitions in downstream workflows.
