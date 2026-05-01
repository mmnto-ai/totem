---
tags: ['rust', 'physics', 'testing', 'simulation']
lifecycle: nursery
---

## Lesson — A linvel.norm() call can overflow to f32::INFINITY even

**Tags:** rust, physics, testing, simulation

A `linvel.norm()` call can overflow to `f32::INFINITY` even when every individual velocity component is finite (e.g., `Vector3::new(f32::MAX, f32::MAX, 0.0)`). Guard speed-dependent logic with `speed.is_finite()` before using the value, and lock this guard with a regression test that constructs a finite-component, infinite-norm vector to confirm the overflow path is handled correctly.
