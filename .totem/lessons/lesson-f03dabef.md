---
tags: ["architecture", "typescript", "cli"]
lifecycle: nursery
---

## Lesson — Duplicating domain object mapping logic across packages

**Tags:** architecture, typescript, cli

Duplicating domain object mapping logic across packages creates maintenance risk and logic drift. Instead of manually reconstructing objects, use canonical converter functions from shared core packages. In CLI environments, use dynamic imports for these shared utilities to maintain package boundaries and optimize startup performance.
