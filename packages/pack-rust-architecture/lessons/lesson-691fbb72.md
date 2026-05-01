---
tags: ['rust', 'testing', 'determinism', 'ecs']
lifecycle: nursery
---

## Lesson — A determinism test that asserts entity-sorted output

**Tags:** rust, testing, determinism, ecs

A determinism test that asserts entity-sorted output can pass vacuously when all entities share the same archetype and the ECS query happens to return them in insertion order. To make the sort a load-bearing property of the test, spawn entities through at least two distinct archetypes so query iteration order is observably non-sorted, then assert the sorted result. Without this, removing the sort leaves the test green.
