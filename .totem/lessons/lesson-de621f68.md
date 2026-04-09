## Lesson — Set exit codes instead of exiting

**Tags:** dx, cli, node
**Scope:** packages/mcp/src/smoke-test.ts

Calling process.exit(1) can terminate a Node.js process before stdout/stderr buffers are fully flushed. Setting process.exitCode and returning from the main function ensures all logs are captured in smoke tests.
