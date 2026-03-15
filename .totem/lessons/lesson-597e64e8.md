## Lesson — Automated gates like pre-commit or pre-push hooks

**Tags:** devtools, performance, automation

Automated gates like pre-commit or pre-push hooks should always use deterministic modes (e.g., `shield --deterministic`) to avoid the high latency and operational cost of LLM calls. This ensures the developer experience remains fast while maintaining a consistent enforcement layer that doesn't rely on non-deterministic model outputs.
