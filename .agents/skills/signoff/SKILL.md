---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

<!-- totem:skill-start -->

End-of-session wrap-up. Post-Proposal-282 (ADR-106), journals + handoffs live in the per-repo `.totem/orchestration/<agent-id>/` tree (gitignored) — NOT the substrate. Substrate stays as a frozen archive for forensic reads; the active surface is local.

0. **Crown gate — derive FIRST (Prop 305 §8; operator-ruled 2026-08-13; non-cohort scope amended by operator word 2026-08-14, recorded on the mmnto-ai/totem-strategy#488 R-table).** **Journal rule first — every seat, every repo:** restate your OWN chain's still-open `owed:` lines only — lines where YOU are the waiter and `@holder:` names the counterparty who owes (naming yourself as `@holder:` makes a note-to-self the parser silently skips) — and never another seat's carryforward: the parser keys each edge's waiter to the journal-owning seat, so a copied line mints a live foreign edge in YOUR chain (a line self-held at its origin is a skipped note-to-self THERE and a LIVE edge in yours) that persists until your own next journal drops it. (Canonical rulings home: mmnto-ai/totem-status#127.) **Then the gate ladder:** read the `totem:agent-bus` marker in this repo's AGENTS.md and check the step-2a cohort table below. No declared marker (absent, or missing `role`/`seat` — the parity sensor's not-declared set) AND this repo's basename is NOT in the cohort table = **non-cohort consumer**: the crown gate does not apply — run your full signoff. No declared marker but the repo IS in the table = a cohort repo that has not normalized: treat as crown **vacant** (fail-closed — the ruled default). Marker declared: derive `primary=` fresh — that seat is the crown; declared but no `primary=` = crown **vacant**. Vacant (either arm) is a legitimate state: surface upkeep stages/defers, mail the operator, and no seat self-promotes (transfer is the operator's word, Prop 305 §8.1; vacancy legitimacy §8.4b). **Before comparing yourself to `primary=`, verify your OWN identity — the signon S0 check applies at signoff too:** your seat derives per step 2a, and a mis-scoped or inherited `TOTEM_SELF_AGENT` naming a foreign seat must not make this session the crown; a foreign or ambiguous self-identity is fail-closed — no crown decision, no upkeep mutations — until the identity is fixed. If you are NOT the crown, your signoff is seat-anchored + own-lane: skip the surface-upkeep MUTATIONS — derived-cache/corpus rebuilds, GH board writes, cohort-wide upkeep walks, and step 4's shared-tree branch cleanup (crown-scoped there by name) — while every OTHER managed step (1–3, 5–6) still runs for every seat, and read-only derivation stays open to all: derive, then report staleness to the crown by mail.

1. **Update memory.** Update auto-memory files (e.g. `MEMORY.md`, topic memories) with any new state — version shipped, tickets closed, key decisions, banked feedback or doctrine signals.

2. **Write a journal entry to the per-repo orchestration path.** Filename convention: `<model>-NNNN-<short-topic-slug>.md` (e.g., `claude-0057-phase-4-resolver-shipped.md`).

   **Resolve the path two steps:**

   a. **Identify your agent-id** from the current repo's basename. The hardcoded map (Proposal 282 § Scope item 3 — keep in sync with the ADR-106 cohort list):

   | Repo (`git rev-parse --show-toplevel` basename) | Claude agent-id                     | Gemini agent-id   | Kimi agent-id     |
   | ----------------------------------------------- | ----------------------------------- | ----------------- | ----------------- |
   | `totem`                                         | `totem-claude`                      | `totem-gemini`    | `totem-kimi`      |
   | `totem-strategy`                                | `strategy-claude`                   | `strategy-gemini` | _(not seated)_    |
   | `liquid-city`                                   | `lc-claude`                         | `lc-gemini`       | _(not seated)_    |
   | `arhgap11`                                      | `arhgap11-claude`                   | `arhgap11-gemini` | _(not seated)_    |
   | `totem-status`                                  | `status-claude`                     | `status-gemini`   | _(not seated)_    |
   | `totem-playground`                              | _(orphan stream — no native agent)_ | _(orphan stream)_ | _(orphan stream)_ |

   Seat discovery is dir-derived (mmnto-ai/totem#2141): any `.totem/orchestration/<agent-id>/` directory registers that seat for this repo, UNIONED with the basename map above so roster siblings stay visible on fresh clones where the gitignored tree is partial (precedence: `TOTEM_SELF_AGENT` env > `config.json` `host_agents` > seat dirs ∪ basename map). Override hook: a `host_agents: string[]` field in `.totem/orchestration/config.json` still **replaces** the derived answer — but omitting a PRESENT seat dir attaches a loud warning naming the omitted seat (the dir is the registration; config-exclusion is not a decommission mechanism). The returned list of agent-ids is used by consumers (e.g., `totem mail`) to filter cross-repo handoffs — messages addressed to any agent-id in the list belong to this repo's session.

   **Visiting case.** If your row's Claude-agent-id column is `_(no Claude variant)_` or `_(orphan stream — no native agent)_`, you are visiting a repo that doesn't natively host your agent. Resolve the journal path to `<repoRoot>/.totem/orchestration/<your-home-agent-id>/journal/`, where `<your-home-agent-id>` is your own agent-id (e.g., a `strategy-claude` session always writes as `strategy-claude` regardless of which repo it's visiting; concretely, `strategy-claude` visiting `totem-status` writes to `totem-status/.totem/orchestration/strategy-claude/journal/`). The journal records the visiting agent's session state — the host repo doesn't need a native Claude agent to be a valid write target.

   b. **Resolve the journal directory** via `resolveOrchestrationPaths(repoRoot, agentId).journal` from `@mmnto/totem`. Returns the absolute path to `<repoRoot>/.totem/orchestration/<agent-id>/journal/` when the tree exists. If `source === 'none'` (the tree does not exist yet in this repo) the resolver returns `null` for every path field — in that case, construct the path manually as `<repoRoot>/.totem/orchestration/<agent-id>/journal/` and create the directory first via `mkdir -p`; the path is gitignored and safe to create.

3. **No commit, no push.** `.totem/orchestration/` is gitignored — local filesystem write is the entire operation. No more substrate rebase-retry loops; the cross-agent write-collision class is eliminated by the single-writer-per-path invariant (you only ever write into your own `<agent-id>/` subtree).

4. **Clean up stale local branches — CROWN ONLY where the crown gate applies (step 0; in a non-cohort repo the gate does not apply and this step simply runs — the named design choice per the mmnto-ai/totem-strategy#488 R8 ruling).** The cleanup mutates the SHARED per-repo working tree — cohort upkeep, not own-lane (worktree-pinned branches refuse deletion, so it is collision-safe, but ownership is the point, not safety). A non-crown cohort seat skips this step and reports any `[gone]` branches to the crown (or, crown vacant, the operator) by mail instead.

   ```bash
   git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | while read -r branch track; do
     [[ "$track" == "[gone]" ]] && git branch -D -- "$branch"
   done
   ```

5. **Prune + compact your own ECL cursor (retention + processed-mark GC).** Delete your own `outbox/` dispatches older than the retention window (**N = 14 days**) per ECL outbox-retention doctrine (`mmnto-ai/totem-strategy:doctrine/ecl-discipline.md` § 4.4), THEN compact your `processed/` cursor per § 4.5 / ADR-106 § A2. The outbox is transport, not archive — a dispatch's durable content already lives in its home (rulings → ADRs / issues, work-state → the GH board, session history → `journal/`), so the aged courier file is disposable (gitignored + local). The `processed/` cursor is the read-side twin: a mark whose inbound dispatch its sender already swept shadows nothing, so it is safely collectable. The operator should never have to janitor the mail substrate.

   **Mechanism:** `totem ecl-gc --apply --compact` — self-resolves your agent-id (same precedence as step 2a: `TOTEM_SELF_AGENT` env > `config.json` `host_agents` > seat-dir ∪ basename map). It **prunes** only `<repoRoot>/.totem/orchestration/<your-agent-id>/outbox/` (a self-resolving binary structurally cannot prune a peer), then **compacts** only your own `processed/` marks that shadow nothing. Compaction is cursor-coupled, not age-based, and deletes ONLY against a provably-complete poll — full expected cohort roster present, zero scan warnings, not truncated — else it retains everything (uncertain ⇒ retain). Dry-run by default; `--apply` deletes. Neither phase touches `journal/`. Report the pruned + collected counts. **Exit codes:** `0` clean · `1` some deletes failed (janitorial sensor) · `2` usage/agent-unresolvable · `3` compaction ABORTED loudly (fail-loud, never a silent skip) — no cohort roster declared, the roster is incomplete on this machine, or its A2.4 re-poll check tripped. **Do not block the seal on `1` or `3`** — the gate-red arms retain the whole cursor (uncertain ⇒ retain); only note them. The gc is a janitorial sensor, not a gate (Tenet 13).

6. **Report:** what shipped, what's pending, what's next.

**Cross-repo handoffs** (when you need to dispatch a message to another agent) write to your own `<repoRoot>/.totem/orchestration/<agent-id>/outbox/<YYYY-MM-DDTHHMMZ>-<your-agent-id>.md` with `to: <recipient-agent-id>` in the frontmatter. Recipients discover inbound handoffs by polling the single-level glob `<workspace>/*/.totem/orchestration/*/outbox/*.md` filtered by their own `to:` frontmatter match.

**Substrate (legacy) is read-only.** Do NOT write new content to `mmnto-ai/totem-substrate:.handoff/` or `:.journal/`. The substrate stays mounted as a frozen archive accessible via `resolveSubstratePaths(cwd)` for forensic reads; the cutover broadcast (when it lands) will confirm the final substrate-write cutoff.

<!-- totem:skill-end -->
