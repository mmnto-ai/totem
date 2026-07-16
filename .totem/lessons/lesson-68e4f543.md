## Lesson — Use sync anchors for inlined standalone code

**Tags:** dx, refactoring, templates
**Scope:** packages/cli/src/commands/init-templates.ts

Standalone scaffolded hooks that cannot import external modules must inline their utility functions. To prevent logic drift, use named sync anchors in comments to link the inlined code to its upstream source, and back the anchor with an executable parity test that runs the rendered artifact against the shared implementation (mmnto-ai/totem#2390: hook-stamped seat asserted equal to `resolveSelfAgents(...).agents[0]`) so semantic drift fails a test instead of relying on review discipline.
