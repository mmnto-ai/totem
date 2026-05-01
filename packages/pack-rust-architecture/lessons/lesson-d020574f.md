---
tags: ['rust', 'security', 'validation', 'simulation']
lifecycle: nursery
---

## Lesson — When a float stride or step value is divided

**Tags:** rust, security, validation, simulation

When a float stride or step value is divided into a dimension to produce loop bounds, a very small positive stride produces a near-infinite float that overflows on `as u32` cast, causing a de-facto infinite loop (DoS). Validate finiteness first, then cast to integer bounds, then guard the integer product with `saturating_mul` or widening to `u64` against a `MAX_TOTAL_CELLS` constant. Guard the integer result, not the pre-cast float product, because float multiplication of boundary-adjacent inputs can panic on inputs that the integer loop would handle safely.
