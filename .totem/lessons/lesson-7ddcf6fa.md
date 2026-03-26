## Lesson — CLI command actions must wrap asynchronous logic

**Tags:** cli, error-handling, nodejs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

CLI command actions must wrap asynchronous logic in a try/catch block that delegates to a centralized error handler. This ensures consistent error reporting across the tool and prevents unhandled promise rejections during dynamic imports or async operations.
