# Annotation System

Totem relies on a semantic annotation system to guide the review pipeline and provide deterministic rule overrides. The `// totem-context:` marker is critical for helping the review pipeline avoid hallucinating about imports or architectural boundaries.

## The Marker Syntax

- **Standard Syntax:** `// totem-context: <reason>` (as defined in ADR-071).
- **Deprecated Syntax:** `// shield-context: <reason>` is the deprecated alias. It functions identically but emits a warning.

## How it Works

1. **Extraction:**
   Annotations are extracted using the regex `/\/\/\s*(?:totem-context|shield-context):\s*(.+)/` in `packages/cli/src/commands/shield-hints.ts:8`.

2. **Injection:**
   The extracted context is injected into the `=== SMART REVIEW HINTS ===` section of the LLM review prompt. This prevents the AI from blindly flagging acceptable deviations from the architecture.

3. **Telemetry & Self-Healing:**
   Every time a `totem-context` directive is encountered by `totem lint` or `totem review`, it is recorded as an `exception` event in `.totem/ledger/events.ndjson`. If a rule accumulates too many exceptions, the self-healing loop (`totem doctor --pr`) will propose downgrading the rule.

4. **Linting vs. Review:**
   `totem-context` suppresses the deterministic lint errors for the following block of code AND provides context to the review AI. It is different from `// totem-ignore`, which is a hard suppression without providing context to the reviewer.

## Example

Real example from the `totem` codebase (`packages/cli/src/commands/init.ts:454`):

```typescript
// totem-context: fs and path are static imports at top of file (lines 1-2)
```

This specific annotation was used to prevent the review agent from flagging top-of-file imports as undefined when they appeared far from the current diff hunk being reviewed.
