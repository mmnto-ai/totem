---
name: signon
description: Session-start — consume/derive orientation, poll mail since last signoff, re-derive carryforward gates, present next-steps for operator ruling
---

<!-- totem:skill-start -->

Session-start bring-up. **Read-only** — no mutations, no dispatches, no board edits until the operator rules on next steps (Proposal 295 d2: read-only orient + grounded next-work). Solo — no agent fleet (`feedback_session_start_derive_cheaply`: cheap derivation IS the validation dogfood).

1. **Consume the injected orientation.** On Claude Code seats the SessionStart hook already injects the latest journal + carryforward, inbound mail, branch/ticket-matched context, and a bounded session-orientation slice (parked/freeze state, open PRs, board↔issue coherence drift, and an open-issue-count pointer) — do not re-run what it injected. Everything else the bring-up needs (the full board in-flight set, corpus freshness, doctrine currency) is derived on demand via `totem orient`. On a hook-less seat (other vendors, cold starts), derive it all: `totem orient`.

2. **Poll mail since last signoff.** `totem mail` — shows unread cross-repo mail addressed to this repo's agent(s) (ADR-106 §3). Unread = inbound − handled: consumption is tracked by `processed/` marks (`feedback_check_outbox_before_replying`), so the CLI path needs no cutoff stamp. Read every hit before proceeding — new mail can reprioritize everything below. (Fallback — a seat that must stamp-poll instead derives the cutoff from the newest journal's CONTENT date, the filename stamp or frontmatter, **never file mtime**, which git resets on clone/worktree and silently reports "inbox clean" over waiting mail; mmnto-ai/totem-strategy#813.)

3. **Re-derive the carryforward gates — don't trust the journal's framing** (Tenet 20 read-side twin). For each carryforward item in the latest journal, freshly derive its gate state (the PR it waits on, the issue, the date, the release train) via `gh` / `git` reads. Cross-repo gates resolve through the frozen cohort roster — `totem` / `strategy` / `status` / `lc` → `mmnto-ai/{totem, totem-strategy, totem-status, liquid-city}` (mmnto-ai/totem-strategy#611 gates any change). An item whose gate fired leads the next-steps list; an item still gated is reported as waiting, not worked.

4. **Surface owed-now sensors.** Anything the injected/derived orientation flags as owed (corpus `⚠ stale`, strategy-doctrine `⚠ publish owed`, board drift) goes on the list as a candidate — sensors report, they don't gate (Tenet 13).

5. **Present and stop.** One message: state summary (inbox, gate states, owed-now items) + ranked next-steps with a recommendation. Then wait for the operator's ruling — signon ends at the judgment handoff; mutations belong to the ruled work, not the bring-up.

<!-- totem:skill-end -->
