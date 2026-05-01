---
tags: ['rust', 'ecs', 'performance', 'bevy']
lifecycle: nursery
---

## Lesson — Per-tick heap allocation in ECS system hot paths (e.g., let

**Tags:** rust, ecs, performance, bevy

Per-tick heap allocation in ECS system hot paths (e.g., `let mut v: Vec<_> = query.iter().collect()`) causes unnecessary allocator pressure every frame. Use `Local<Vec<T>>` as a system parameter, call `.clear()` then `.extend(...)` at the top of the system, and iterate with `.iter().copied()`. This keeps the system allocation-free after the first tick while preserving identical semantics.
