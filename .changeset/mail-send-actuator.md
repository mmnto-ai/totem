---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(cli): `totem mail send` / `mail reply` outbound actuator (#2042)

Adds the actuator half of the ADR-106 coordination triad (the sensor `totem mail`
already shipped). Before this, `totem mail send` silently fell through to the read
command and every dispatch was hand-authored against five undocumented conventions —
a discipline the protocol structurally could not satisfy (Tenet 13: sensor without
actuator).

- `totem mail send --to --subject [--from --body-file --in-reply-to --priority --related --expected-action --slug]`
  composes + writes a **ADR-098 v0.4-compliant** dispatch (`schema:` / `timestamp:` /
  `expected-action:`) to the sender's own outbox; totem is now the first v0.4-compliant
  emitter. `totem mail reply <source>` is sugar that infers recipient + subject + `in-reply-to`.
- The write-side validator is **fail-open** (ADR-106 inv6): structural validity is
  enforced by construction (a malformed-shape dispatch is unrepresentable), while content
  predicates that can't be guaranteed at construction (unknown recipient, empty refs) emit
  a **loud emit-time warning** and write anyway — a blocked dispatch is worse than a
  malformed one (#2119). Usage errors (missing to/subject, ambiguous/unresolvable self,
  unreadable body-file) and actuation failures stay hard-fail (Tenet 4).
- Registering the subcommands also closes the silent fall-through: `totem mail <unknown>`
  now hard-errors instead of running the read as a no-op.
- `parseHeader` now reads `timestamp:` (v0.4 canonical) with `date:` backwards-compat
  fallback; the surfaced `MailEntry.date` field name is unchanged (no blast-radius rename).
- `@mmnto/totem` exports `knownCohortAgents()` — the single source of truth for the
  recipient set, derived from the cohort map (a hardcoded list in the actuator would
  re-introduce the very drift this command fights).

Emit-shape + the reader change concurred by strategy-claude (ADR-098 owner); OQ-1 ruled 1b.
