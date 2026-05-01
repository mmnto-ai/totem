---
tags: ['rust', 'const-eval', 'compile-time', 'architecture']
lifecycle: nursery
---

## Lesson — Float arithmetic methods are unavailable in Rust const-eval

**Tags:** rust, const-eval, compile-time, architecture

Rust's const evaluator (as of 1.95) does not include float arithmetic methods — `.floor()`, `.ceil()`, `.round()`, `.trunc()`, `.sqrt()`, `.powf()`, `.powi()`, `.abs()`, and the trig/log family are all non-const. A `const _: () = assert!((WIDTH / STRIDE).floor() as u32 * ... >= COUNT);` will not compile, even though the same expression compiles fine at runtime. The rewrite is to perform the division at full precision and then cast the quotient to the integer type — float-to-integer cast in const context truncates for non-negative operands, which is the floor semantic for the typical spawn-grid / cell-count case: `const _: () = assert!(((WIDTH / STRIDE) as u32) * ((HEIGHT / STRIDE) as u32) >= COUNT);`. Critically, do **not** cast the operands before dividing — the form `(WIDTH as u32 / STRIDE as u32)` truncates each operand to an integer first, losing the fractional component of the divisor and producing a different (often wrong) result for non-integer strides. Specs that ship const-assert pseudocode should be either compile-tested or include an explicit "verified to compile" note in the spec body — broken const-assert pseudocode silently passes spec review and ships an unverifiable invariant to the impl PR. Cited evidence: liquid-city PR #132 R1 (`spec.floor()` failure on slice-6 spawn-grid invariant); subsequent rewrite to divide-then-cast on the same invariant.
