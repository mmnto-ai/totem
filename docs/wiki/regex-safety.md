# Regex Safety

Totem's compile pipeline rejects regex patterns that the `safe-regex2` static analyzer flags as ReDoS-prone (catastrophic backtracking under adversarial input). This page documents two empirically-verified pattern idioms for a common authoring case the gate makes non-obvious: matching an identifier with optional module-path qualification.

## The gate

`safe-regex2` uses a star-height heuristic. Any quantifier (`*`, `+`, `{n,}`) that wraps a sub-expression also containing a quantifier is rejected, regardless of whether the inner separator is unambiguous. Nested-quantifier shapes the gate rejects:

- `(a+)+` — classic catastrophic backtracking
- `([a-zA-Z]+)*` — character class with quantifier under outer quantifier
- `(.*a){10}` — bounded outer quantifier still nests `*`
- `\b(?:[A-Za-z_]\w*::)*Target\b` — identifier-class with `\w*` under `(?:...)*`

The compile pipeline reports rejections as `Rejected regex: ReDoS vulnerability detected` and skips the rule.

## The authoring trap

A natural shape for "match `Target` with an optional module-path prefix" is `\b(?:[A-Za-z_]\w*::)*Target\b`. It looks safe (the `::` separator is unambiguous so the pattern is linear in practice), but `safe-regex2` rejects it because of the star-height heuristic.

The shape `\bWrapper\s*<\s*(?:[A-Za-z_][A-Za-z0-9_:]*::)?Target\s*>` fails for the same family of reasons (the embedded `:` in the character class plus the literal `::` terminator is the canonical adversarial backtracking shape; `safe-regex2` flags it correctly).

Two safe forms cover the same intent.

## Form 1 — Suffix-anchor

```regex
(?:::|\b)Target\b
```

Star height 1 (no nested quantifiers).

**Matches:**

- `Target` (bare, anywhere — the leading `\b` matches at the word boundary)
- `crate::state::Target` (the leading `::` matches at the `state::` boundary)
- `super::Target`
- `&mut Target`
- `&mut super::Target`
- `ResMut<crate::state::Target>` (matches inside the wrapper at the `state::` boundary)

**Does not match:**

- `MyTarget` (no `::` and no `\b` between `My` and `Target`)
- `TargetExtra` (trailing `\b` blocks)

**When to use:** the rule should fire on the identifier regardless of what container surrounds it.

## Form 2 — Bounded wrapper

```regex
\bWrapper\s*<[^<>]{0,256}\bTarget\s*>
```

Star height 1 (`{0,256}` is a bounded quantifier; `[^<>]` has no nested quantifier).

**Matches:**

- `Wrapper<Target>`
- `Wrapper<crate::state::Target>`
- `Wrapper<super::Target>`
- `fn foo(state: Wrapper<crate::director::state::Target>) {}` (path content is bounded by `[^<>]{0,256}`)

**Does not match:**

- `&mut Target` (no `Wrapper<...>` envelope)
- `let x: Target = ...` (no `Wrapper<...>` envelope)
- `Wrapper<TargetExtra>` (interior `\b` blocks the prefix collision)

**When to use:** the rule should fire only when `Target` appears inside a specific typed container (e.g., `ResMut<Target>` for a Bevy ECS mutability hardening rule, `Box<Target>` for an ownership rule).

## Anti-pattern

Do not try to literally match an unbounded number of `<ident>::` segments via repetition. The gate will reject every shape that nests a quantifier under another quantifier. The two forms above match the same set of identifier forms without the gate-rejected shape.

If a rule genuinely needs to walk an unbounded path of arbitrary depth, regex is the wrong tool. Use ast-grep with `kind:` and `inside:` combinators instead, which parse the source structurally and do not rely on regex backtracking. See [The Pipeline Engine](pipeline-engine.md) for ast-grep authoring guidance.

## Verifying a pattern locally

`safe-regex2` is the same package the compile gate uses. Verify a candidate pattern against it before authoring the lesson:

```text
node -e "console.log(require('safe-regex2')(String.raw\`<your-pattern>\`))"
```

A `true` result means the pattern passes the gate. A `false` result means it will be rejected at compile time.

## Background

The two safe forms emerged from a 2026-04-24 audit of an upstream-feedback item (`mmnto-ai/totem-strategy` item `016-redos-gate-blocks-module-path-patterns.md`) that originally proposed the trap shape above as canonical. The trap shape was caught at preflight verification. The full reasoning chain lives in:

- `mmnto-ai/totem-strategy:upstream-feedback/016-redos-gate-blocks-module-path-patterns.md` (with the 🔴 CORRECTION preamble naming the empirical update)
- `mmnto-ai/totem` issue [#1657](https://github.com/mmnto-ai/totem/issues/1657)
- The `module-path-tolerant regex patterns (#1657)` test block in `packages/core/src/compiler.test.ts` pins both safe forms as accepted and the trap shapes as rejected.

## Related

- [The Pipeline Engine](pipeline-engine.md) — pipeline architecture for rule creation
- [CLI Reference](cli-reference.md) — `totem lint --timeout-mode` for the runtime ReDoS budget that complements the input-time gate documented here
