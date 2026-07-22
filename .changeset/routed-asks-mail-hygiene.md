---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

Seat `status-claude` in the cohort roster and stop the unquoted-subject dispatch class at the sender.

- `COHORT_AGENT_MAP` gains `status-claude` for `totem-status` (cohort-roles §1.1 roster ruling, mmnto-ai/totem-strategy#958): dispatches addressed to the seat now resolve via CLI polls even on checkouts where the gitignored seat dir is absent. The distributed signoff skill's agent-id table follows.
- PreWriteShield (Claude) and BeforeTool (Gemini) gain Rule 3, the ECL dispatch frontmatter-quoting guard (routed ask from mmnto-ai/totem-status#123): an unquoted `: ` or trailing `:` in a `subject:`/`expected-action:` value under `.totem/orchestration/*/outbox/` blocks at write time, so strict-YAML mail consumers never de-sync from the lenient TS delivery path.
