---
'@mmnto/cli': minor
---

Add `totem ecl-gc` — the binary-guaranteed, cohort-wide replacement for the interim `scripts/prune-outbox.mjs` (mmnto-ai/totem#2279; parent mmnto-ai/totem-strategy#700; doctrine/ecl-discipline.md § 4.4). It prunes the calling agent's OWN aged ECL outbox dispatches: `totem ecl-gc` self-resolves the single self-agent (reusing `resolveSelfSender`'s explicit > unambiguous-self > throw precedence) and prunes only `<repoRoot>/.totem/orchestration/<agent>/outbox/`, so a self-resolving binary structurally cannot prune a peer, `journal/`, or `processed/`.

Dry-run by default (lists would-prune, deletes nothing); `--apply` deletes. Flags: `--retain-days <n>` (default 14), `--agent-id <id>` (visiting/orchestrator override), `--json` (structured stdout). Only `.md` dispatches with a parseable dual-form stamp (`YYYY-MM-DDTHHMMZ` or `…HHMMSSZ`) are eligible; the exact retention boundary is retained; non-file / non-`.md` / unparseable entries are surfaced and never deleted. Exit codes: 0 clean, 1 partial delete failure (janitorial sensor, non-blocking — Tenet 13), 2 usage error. The distributed `signoff` skill gains a prune step (step 5) wiring `totem ecl-gc --apply` into end-of-session cleanup. This train ships prune only; processed-mark compaction is a deferred follow-on, and `scripts/prune-outbox.mjs` is intentionally left in place.
