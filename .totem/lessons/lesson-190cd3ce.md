## Lesson — Avoid fail-closed hooks during bootstrap

**Tags:** claude-code, dx, bootstrap
**Scope:** .claude/hooks/gate-wrapper.cjs

Strict pre-tool hooks that fail closed when local dependencies are missing can block the very package installation commands (e.g., `pnpm install`) needed to bootstrap the repository. Give the hook a fallback resolution path (a CLI on PATH evaluating the same gate) so the gate stays evaluable during bootstrap; an applicable gate that cannot be evaluated still fails closed, and the block message must name exits that are not themselves gated.
