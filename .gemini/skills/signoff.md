<!-- [totem] Gemini parity for the Claude /signoff skill — Proposal 282 / ADR-106 -->

# Totem Signoff (Gemini parity)

End-of-session wrap-up for Gemini agents. Mirrors the `/signoff` skill at `.claude/skills/signoff/SKILL.md`. Post-Proposal-282 (ADR-106), journals + handoffs live in the per-repo `.totem/orchestration/<agent-id>/` tree (gitignored) — NOT the substrate. Substrate stays as a frozen archive for forensic reads; the active surface is local.

## When to invoke

At end of session, after the main task is wrapped: when the user signals completion, when context is becoming long enough to compact, or when shipping a meaningful milestone (PR merged, design decision made, doctrine banked).

## Steps

1. **Update memory.** Update any agent-managed memory files with new state — version shipped, tickets closed, key decisions, banked feedback or doctrine signals.

2. **Write a journal entry to the per-repo orchestration path.** Filename convention: `gemini-NNNN-<short-topic-slug>.md` (e.g., `gemini-0042-phase-4-dashboard-shipped.md`).

   **Resolve the path two steps:**

   a. **Identify the agent-id from the current repo's basename.** Hardcoded map (Proposal 282 § Scope item 3 — keep in sync with the ADR-106 cohort list):

   | Repo (`git rev-parse --show-toplevel` basename) | Gemini agent-id                     |
   | ----------------------------------------------- | ----------------------------------- |
   | `totem`                                         | `totem-gemini`                      |
   | `totem-strategy`                                | `strategy-gemini`                   |
   | `liquid-city`                                   | `lc-gemini`                         |
   | `arhgap11`                                      | `arhgap11-gemini`                   |
   | `totem-status`                                  | `status-gemini`                     |
   | `totem-playground`                              | _(orphan stream — no native agent)_ |

   Override hook: if the consuming repo carries `.totem/orchestration/config.json` with a `host_agents: string[]` field, prefer that list over the hardcoded map. Reserved for repos that legitimately host an agent not in the default map.

   b. **Resolve the journal directory.** The Node-side primitive is `resolveOrchestrationPaths(repoRoot, agentId).journal` from `@mmnto/totem`; invoke via shell as needed. The journal directory is `<repoRoot>/.totem/orchestration/<agent-id>/journal/`. If absent, create it first (`mkdir -p`); the path is gitignored and safe to create.

3. **No commit, no push.** `.totem/orchestration/` is gitignored — local filesystem write is the entire operation. No substrate rebase-retry loops; the cross-agent write-collision class is eliminated by the single-writer-per-path invariant (only ever write into your own `<agent-id>/` subtree).

4. **Clean up stale local branches:**

   ```bash
   git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | while read -r branch track; do
     [[ "$track" == "[gone]" ]] && git branch -D -- "$branch"
   done
   ```

5. **Report:** what shipped, what's pending, what's next.

## Cross-repo handoffs

When dispatching a message to another agent, write to your own outbox at `<repoRoot>/.totem/orchestration/<agent-id>/outbox/<YYYY-MM-DDTHHMMZ>-<your-agent-id>.md` with `to: <recipient-agent-id>` in the frontmatter. Recipients discover inbound handoffs by polling the single-level glob `<workspace>/*/.totem/orchestration/*/outbox/*.md` and filtering on their own `to:` frontmatter match.

## Substrate is read-only

Do NOT write new content to `mmnto-ai/totem-substrate:.handoff/` or `:.journal/`. The substrate stays mounted as a frozen archive accessible via `resolveSubstratePaths(cwd)` for forensic reads; the cutover broadcast (when it lands) will confirm the final substrate-write cutoff.
