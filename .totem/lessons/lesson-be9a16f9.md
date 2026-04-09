## Lesson — Resilient continuation for transient federated link failures

**Tags:** mcp, search, resilience, architecture
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

When a federated link fails transiently (file lock, stale handle during a parallel `totem sync`, network blip, brief unavailability), the architectural choice is between **eviction** — remove the broken store from the active pool until server restart — and **resilient continuation** — keep the store in the pool and attempt a targeted reconnect on every query.

Eviction is the obvious-looking optimization (fewer failing queries, less log spam) but has a critical failure mode: any transient issue causes **permanent context loss** until the MCP server restarts. A subsequent fix in the linked repository cannot be picked up without restart. The agent silently loses access to a real source of context based on a temporary failure.

The correct pattern is **resilient continuation**:

1. Leave the failing link in `linkedStores` even after a search failure
2. On each subsequent query, attempt a targeted `reconnect()` + retry
3. Surface per-query runtime warnings to the agent so the failure stays visible
4. Let the next call try again — the underlying issue may have cleared

Trades some log spam for resilience. Per Tenet 4 (Fail Loud, Never Drift), session-persistent state should not be mutated by transient failures. The PR #1295 review cycle established this pattern after an earlier eviction-based revision was rejected by the GCA + CR review for exactly this reason.

This is a conceptual/architectural pattern, not a compilable rule.
