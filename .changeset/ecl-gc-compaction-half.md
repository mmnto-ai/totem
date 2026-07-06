---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

Add `totem ecl-gc --compact` — cursor-coupled processed-mark compaction, the read-side sibling of the outbox prune (mmnto-ai/totem#2307; parent mmnto-ai/totem-strategy#700; contract ADR-106 § A2 + `ecl-discipline` § 4.5, ratified strategy#826).

Compaction deletes an agent's OWN `processed/` marks that shadow nothing — a mark whose inbound dispatch its sender already swept per § 4.4. The retained cursor is `processed ∩ raw-addressed-inbound`, where the raw set is the **pre-dedupe** discovery (a new `includeProcessed` option on `pollMail`), never `pollMail`'s `inbound − processed` list — feeding that back would delete every retained mark (the § A2.1 false-unread bomb). Deletion is licensed ONLY against a **provably-complete** poll (§ A2.2: full expected cohort roster present, zero scan warnings, not truncated — else zero deletes, uncertain ⇒ retain), binds to **exactly one seat** (§ A2.3), and **self-verifies** via an immediate re-poll (§ A2.4).

Per the contract-owner roster ruling (strategy-claude), the completeness gate's declared roster is a **consumer-config-declared** expectation, not a core constant — `totem ecl-gc` ships, so a hardcoded cohort roster is a Tenet-16 product-vs-cohort lock. `@mmnto/totem` gains `cohortRepos()` as the **explicitly-marked interim** value (the strategy#611 frozen active set; authority stays strategy#611; config-ify tracked in #2310). The **safety corollary**: an undeclared (empty) roster makes compaction a **no-op** (opt-in), never "assume complete." An operator `--force-incomplete` escape waives only the roster-presence arm (scan warnings / truncation still abort).

Runs after the prune inside `/signoff` (`totem ecl-gc --apply --compact`). Combined exit contract: `0` clean (incl. the undeclared-roster skip) · `1` partial janitorial delete failure (prune or compact) · `2` usage/agent-unresolvable · `3` compaction abort (A2.2 gate red with a DECLARED roster, or A2.4 falsifier tripped) — `3` outranks `1`. Prune behavior (`totem ecl-gc` with no `--compact`) is unchanged.
