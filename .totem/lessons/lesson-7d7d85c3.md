## Lesson — Sanitize untrusted diffs in prompts

**Tags:** llm, security
**Scope:** packages/cli/src/commands/extract-templates.ts

Code diffs included in LLM prompts must be treated as untrusted input and sanitized to prevent prompt injection. Developers might intentionally or accidentally include instruction-like text in comments or strings within a diff that could hijack the model's behavior.
