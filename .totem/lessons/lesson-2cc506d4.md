## Lesson — Ensure that sanitization or masking applies to both

**Tags:** architecture, security, llm

Ensure that sanitization or masking applies to both the primary request and any fallback or retry paths in the orchestrator pipeline. Neglecting to use the sanitized payload in retry logic can result in accidental data leakage during service instability.
