---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

<!-- totem:skill-start -->

End-of-session wrap-up. Post-Proposal-282 (ADR-106), journals + handoffs live in the per-repo `.totem/orchestration/<agent-id>/` tree (gitignored) — NOT the substrate. Substrate stays as a frozen archive for forensic reads; the active surface is local.

1. **Update memory.** Update auto-memory files (e.g. `MEMORY.md`, topic memories) with any new state — version shipped, tickets closed, key decisions, banked feedback or doctrine signals.

2. **Write a journal entry to the per-repo orchestration path.** Filename convention: `<model>-NNNN-<short-topic-slug>.md` (e.g., `claude-0057-phase-4-resolver-shipped.md`).

   **Resolve the path two steps:**

   a. **Identify your agent-id** from the current repo's basename. The hardcoded map (Proposal 282 § Scope item 3 — keep in sync with the ADR-106 cohort list):

   | Repo (`git rev-parse --show-toplevel` basename) | Claude agent-id                     | Gemini agent-id   |
   | ----------------------------------------------- | ----------------------------------- | ----------------- |
   | `totem`                                         | `totem-claude`                      | `totem-gemini`    |
   | `totem-strategy`                                | `strategy-claude`                   | `strategy-gemini` |
   | `liquid-city`                                   | `lc-claude`                         | `lc-gemini`       |
   | `arhgap11`                                      | `arhgap11-claude`                   | `arhgap11-gemini` |
   | `totem-status`                                  | _(no Claude variant)_               | `status-gemini`   |
   | `totem-playground`                              | _(orphan stream — no native agent)_ | _(orphan stream)_ |

   Override hook: if the consuming repo carries `.totem/orchestration/config.json` with a `host_agents: string[]` field, prefer that list over the hardcoded map. Reserved for repos that legitimately host an agent not in the default map.

   b. **Resolve the journal directory** via `resolveOrchestrationPaths(repoRoot, agentId).journal` from `@mmnto/totem`. Returns the absolute path to `<repoRoot>/.totem/orchestration/<agent-id>/journal/`. If `source === 'none'` (the tree does not exist yet in this repo), create the directory first via `mkdir -p`; the path is gitignored and safe to create.

3. **No commit, no push.** `.totem/orchestration/` is gitignored — local filesystem write is the entire operation. No more substrate rebase-retry loops; the cross-agent write-collision class is eliminated by the single-writer-per-path invariant (you only ever write into your own `<agent-id>/` subtree).

4. **Clean up stale local branches:**

   ```bash
   git branch -vv | grep ': gone]' | awk '{print $1}' | xargs git branch -D
   ```

5. **Report:** what shipped, what's pending, what's next.

**Cross-repo handoffs** (when you need to dispatch a message to another agent) write to your own `<repoRoot>/.totem/orchestration/<agent-id>/outbox/<YYYY-MM-DDTHHMMZ>-<your-agent-id>.md` with `to: <recipient-agent-id>` in the frontmatter. Recipients discover inbound handoffs by polling the single-level glob `<workspace>/*/.totem/orchestration/*/outbox/*.md` filtered by their own `to:` frontmatter match.

**Substrate (legacy) is read-only.** Do NOT write new content to `mmnto-ai/totem-substrate:.handoff/` or `:.journal/`. The substrate stays mounted as a frozen archive accessible via `resolveSubstratePaths(cwd)` for forensic reads; the cutover broadcast (when it lands) will confirm the final substrate-write cutoff.

<!-- totem:skill-end -->
