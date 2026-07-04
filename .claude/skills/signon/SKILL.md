---
name: signon
description: Session-start — consume/derive orientation, poll mail since last signoff, re-derive carryforward gates, present next-steps for operator ruling
---

<!-- totem:skill-start -->

Session-start bring-up. **Read-only** — no mutations, no dispatches, no board edits until the operator rules on next steps (Proposal 295 d2: read-only orient + grounded next-work). Solo — no agent fleet (`feedback_session_start_derive_cheaply`: cheap derivation IS the validation dogfood).

1. **Consume the injected orientation.** On Claude Code seats the SessionStart hook already injects AGENTS.md, design-tenets, the GH-board in-flight set, freeze state, the latest journal + carryforward, corpus freshness, and strategy-doctrine currency — do not re-run what it injected. On a hook-less seat (other vendors, cold starts), derive it: `pnpm orient`.

2. **Poll mail since last signoff.** `node scripts/poll-cohort-mail.mjs --to <my-agent-id> --since <Z-stamp>` — stamp format `YYYY-MM-DDTHHMMZ`; derive `<Z-stamp>` from the newest journal's CONTENT date in your own `.totem/orchestration/<my-agent-id>/journal/` — the filename stamp or frontmatter date, **never file mtime** (git resets mtimes on clone/worktree, so mtime silently reports "inbox clean" over waiting mail; mmnto-ai/totem-strategy#813). Unread = inbound − handled (`feedback_check_outbox_before_replying`); read every hit before proceeding — new mail can reprioritize everything below.

3. **Re-derive the carryforward gates — don't trust the journal's framing** (Tenet 20 read-side twin). For each carryforward item in the latest journal, freshly derive its gate state (the PR it waits on, the issue, the date, the release train) via `gh` / `git` reads. Cross-repo gates resolve through the frozen cohort roster — `totem` / `strategy` / `status` / `lc` → `mmnto-ai/{totem, totem-strategy, totem-status, liquid-city}` (mmnto-ai/totem-strategy#611 gates any change). An item whose gate fired leads the next-steps list; an item still gated is reported as waiting, not worked.

4. **Surface owed-now sensors.** Anything the injected/derived orientation flags as owed (corpus `⚠ stale`, strategy-doctrine `⚠ publish owed`, board drift) goes on the list as a candidate — sensors report, they don't gate (Tenet 13).

5. **Present and stop.** One message: state summary (inbox, gate states, owed-now items) + ranked next-steps with a recommendation. Then wait for the operator's ruling — signon ends at the judgment handoff; mutations belong to the ruled work, not the bring-up.

<!-- totem:skill-end -->
