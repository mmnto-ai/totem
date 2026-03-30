## Lesson — Using push(...parts) is safer than an if/else block

**Tags:** typescript, clean-code

Using `push(...parts)` is safer than an `if/else` block for single vs. multiple items because it eliminates redundant logic and ensures the same transformation pipeline is applied regardless of item count.
