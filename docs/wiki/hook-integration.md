# Hook Integration

Totem enforces architectural invariants and maintains vector memory by running natively inside git hooks.

## Language-Agnostic Hooks

As of 1.5.0, Totem uses a completely language-agnostic hook installation process. This ensures hooks run reliably across all ecosystems (Node, Python, Go, Rust) without relying on JS-specific tools like Husky.

## Helper Scripts (`.totem/hooks/*.sh`)

Totem manages its hook logic via helper scripts located in `.totem/hooks/`.

- The main git hooks in `.git/hooks/` simply delegate to these `.totem/hooks/*.sh` scripts.
- This allows updates to Totem's hook execution logic without rewriting the underlying git configuration files.

## Shield Context in Hooks

The `pre-push` hook natively triggers `totem lint` (the zero-LLM fast path). If a rule fails, you can use the `// shield-context:` annotation or `// totem-ignore` inline directives to adjust behavior during the AI-powered `totem shield` review process prior to merging.
