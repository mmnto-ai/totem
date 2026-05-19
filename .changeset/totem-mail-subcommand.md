---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(cli+core): `totem mail` cross-repo outbox poll subcommand (mmnto-ai/totem#1970)

Closes [mmnto-ai/totem#1970](https://github.com/mmnto-ai/totem/issues/1970). Option B locked per [ADR-107](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-107-ecl-canonical-over-a2a.md) (Ephemeral Coordination Layer canonical; no network-RPC alternative adopted).

New `totem mail` subcommand surfaces unread mail addressed to this repo's agent(s) by scanning sibling-repo outboxes per [ADR-106 § 3](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-106-ephemeral-coordination-layer.md). Provides the first canonical implementation of the spec so consumer repos (`totem`, `liquid-city`, `arhgap11`, `totem-status`, etc.) pick the poll up via cohort sync rather than each maintaining its own copy. Before this, only `mmnto-ai/totem-strategy` had a working poll (the reference impl in its SessionStart hook); other cohort repos had no implementation at all.

Empirically motivated: two outbound handoffs from `strategy-claude` (`2026-05-18T1734Z` → `totem-claude`; `2026-05-18T1918Z` → `lc-claude`) sat undelivered for ~30-36h despite valid `to:` frontmatter because [ADR-106 § 3](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-106-ephemeral-coordination-layer.md) specified the cross-repo outbox-poll mechanism but no recipient repo's hook implemented it. The strategy-side reference implementation ([`mmnto-ai/totem-strategy#373`](https://github.com/mmnto-ai/totem-strategy/pull/373), merged at `ea0ee6d`) validated the behavior contract; this PR is the canonical port.

## Surfaces

- **`packages/core/src/orchestration-resolver.ts`** — new `resolveSelfAgents(repoRoot, env?)` helper with the cohort agent-id map plus a 3-layer precedence chain (`TOTEM_SELF_AGENT` env > `.totem/orchestration/config.json` `host_agents` > basename map > `[]`). Mirrors `resolveOrchestrationPaths`'s path-traversal guard so a malicious or buggy `host_agents` entry drops at the validation boundary instead of escaping `.totem/orchestration/`.
- **`packages/cli/src/commands/mail.ts`** — `pollMail()` programmatic entry returning a structured `MailPollResult` plus `mailCommand()` CLI wrapper. Reusable by hooks (JSON output), MCP audit tools, and future surfaces.
- **`packages/cli/src/index.ts`** — `totem mail [--json] [--recursive] [--workspace <path>]` registration alongside the existing administrative subcommands.

## Behavior contract (locked per ADR-107 § Consequences)

- **Match**: case-insensitive on `to:` frontmatter value against the SELF_AGENT set or literal `broadcast`. Required for back-compat with the existing `to: arhgap11-Gemini` capitalization in an outbox file.
- **Exclude**: files whose basename appears in any SELF_AGENT's `processed/` or `processed/_broadcast/` directory.
- **Workspace**: parent directory of `repoRoot` by default; `TOTEM_WORKSPACE` env var or `--workspace` flag override.
- **Recursive**: opt-in via `--recursive` flag. The default scans `<workspace>/*/.totem/orchestration/*/outbox/*.md`; recursive descends up to 6 levels skipping dot-dirs and `node_modules`.
- **Latency cap**: `MAX_SCAN=500` files scanned per invocation. When tripped, result carries `truncated: true` so the caller can surface the warning instead of silently dropping mail.
- **Sort**: newest-first by frontmatter `date:` with filename fallback.
- **Frontmatter safety**: only the header block (text before the first blank line) is parsed for `to:` / `from:` / `subject:` / `date:`. Body lines starting with `to:` cannot fabricate a match or overwrite displayed metadata.
- **Failure stance**: never throws on filesystem failure; degrades to warnings on the result so a degraded workspace state does not block the poll.

## Tests

- 23 new resolver tests cover the basename map for every cohort repo, `host_agents` override precedence, `TOTEM_SELF_AGENT` env precedence, comma-separated list parsing, path-traversal rejection at every layer, malformed JSON tolerance, and `path.resolve` normalization on relative inputs.
- 29 new mail-command tests cover basic filter behavior, broadcast handling, processed/ + processed/\_broadcast/ exclusion, multi-agent repo behavior, newest-first sort, CRLF line endings, frontmatter-header restriction (body forge attempt), workspace + recursive options, `node_modules` skip, and `MAX_SCAN` truncation.
- Smoke-tested against the live cohort workspace: surfaces the three handoffs currently addressed to `totem-claude` in `mmnto-ai/totem-strategy:.totem/orchestration/strategy-claude/outbox/`.

## SELF_AGENT resolution rationale (`mmnto-ai/totem#1970` Q1)

The signoff skill at `.claude/skills/signoff/SKILL.md` already names the resolution mechanism in prose (basename → agent-id table + `.totem/orchestration/config.json` `host_agents` override). Encoding that prose into a reusable helper rather than re-deriving in each consumer is the path Tenet 15 (Axiom Mandate) implies: encode as mechanism, not prose. The env-var precedence is the hook surface — hooks set `TOTEM_SELF_AGENT` to declare identity when running inside a CI/test/visiting context where the basename heuristic does not apply.

## Consumer migration (not in this PR)

Once this lands and cohort-propagates, the strategy-side `pollInboundOutboxes` reference impl in [`mmnto-ai/totem-strategy:.claude/hooks/SessionStart.cjs`](https://github.com/mmnto-ai/totem-strategy/blob/main/.claude/hooks/SessionStart.cjs) is superseded — each consumer's hook can `exec totem mail --json` and inject the structured result. Per-vendor handling stays in the hooks themselves; the poll body is identical. Strategy-Claude has flagged the consumer-side cutover for cohort-sync after this ships.
