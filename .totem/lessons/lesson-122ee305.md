## Lesson — SIGINT/SIGTERM handlers that call process.removeListener

**Tags:** manual

SIGINT/SIGTERM handlers that call process.removeListener must reference the exact function object that was registered. Using wrapper functions (e.g., onSigint = () => cleanup('SIGINT')) means the wrapper must be removed, not the inner function. Mismatched references cause silent listener leaks and infinite re-raise loops on signal delivery. Tags: concurrency, signals, node
