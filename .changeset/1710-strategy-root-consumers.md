---
'@mmnto/mcp': minor
'@mmnto/cli': patch
---

feat(consumers): port to `resolveStrategyRoot` (mmnto-ai/totem#1710)

Builds on the `@mmnto/totem` resolver substrate. Each programmatic consumer
of the strategy repo now reads through `resolveStrategyRoot` and degrades
gracefully when the strategy root is unresolvable.

**`@mmnto/mcp`:**

- **Breaking:** `describe_project` rich-state `strategyPointer` payload
  flips from `{ sha, latestJournal }` to a discriminated union:
  `{ resolved: true, sha, latestJournal } | { resolved: false, reason }`.
  Agents that read the rich-state pointer must check `resolved` before
  reading `sha` / `latestJournal`. Only affects callers that opted in via
  `includeRichState: true` — the legacy slim payload is byte-identical.
- **Auto-injected strategy linkedIndex.** `initContext` consults
  `resolveStrategyRoot` and prepends the resolved strategy path to the
  linkedIndexes iteration with a stable link name `'strategy'`. Boundary
  routing (`boundary: 'strategy'`) keeps working regardless of physical
  source (sibling / submodule / env override). Init-time warnings surface
  ONLY when the user explicitly signaled a strategy expectation (env or
  config); zero-config projects without a strategy repo skip silently.

**`@mmnto/cli`:**

- `totem proposal new` / `totem adr new` use `resolveStrategyRoot` and
  throw an actionable `TotemError` (ADR-088) with sibling-clone hint
  when unresolved. Standalone strategy-repo case (cwd IS the strategy
  repo) is detected before the resolver runs.
- New `totem doctor` "Strategy Root" advisory diagnostic (`pass` /
  `warn`, never `fail`).
- Bench scripts (`scripts/benchmark-compile.ts`, `scripts/bench-lance-open.ts`)
  hard-fail with actionable messages when the strategy root is unresolvable.

**`totem.config.ts`:** the literal `linkedIndexes: ['.strategy']` is
removed; the resolver is now the single source of truth for the strategy
mesh path.

**Documentation:** new `CONTRIBUTING.md` "Strategy Repo Expectations"
section + `docs/architecture.md` update describing the configurable
resolver.

`.gitmodules` removal is a separate follow-up after this lands.
