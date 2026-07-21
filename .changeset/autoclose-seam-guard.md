---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(autoclose): GitHub auto-close enforcement-seam guard — D1 + D2-observe + C (#1762)

Adds the ruled Layer-1 slice of the GitHub auto-close guard: a defense against a
close-keyword adjacent to an issue reference (`Closes #131`, and — the confirmed
#2471→#2466 incident — even a negated `Does not close #2466`) reaching a PR body
or squash merge-commit body and auto-closing a linked issue.

- **Core** ships `@mmnto/totem` `autoclose` — the ONE shared evaluator
  (`AUTO_CLOSE_REGEX_SOURCE` / `findAutoCloseRefs`) plus the D1 corpus scan
  (`scanPrCorpus`), the durable receipt (`buildReceipt`), the D2 observation-mode
  reconciler (`reconcile`), and the merge-config posture assertion
  (`evaluateMergeConfigPosture`). Presence invariant, zero semantics: any
  close-keyword-adjacent ref is an anomaly (genuine, negated, quoted, emphasized
  alike — no negation parser). Qualified `owner/repo#N` AND the issue/PR URL form
  match too; comment bodies are never scanned. Intended closures are authorized
  ONLY by a provenance-distinct `<!-- totem-close: #N -->` marker — GitHub's
  `closingIssuesReferences` is derived from the same body keyword and so is
  recorded as informational, never authorizing (breaks the self-whitelist
  circularity).

- **CLI** extends the hand-written hook templates (`init-templates.ts`) — the
  Claude PreWriteShield and the Gemini BeforeTool parity surface (which gates on
  Gemini's real `write_file` + `replace` tools) — to block close-keyword-adjacent
  refs in `**/*.md` writes (EXEMPT `.github/**` and `.totem/**`), sharing core's
  `AUTO_CLOSE_REGEX_SOURCE`. No new managed session hook; the roster is unchanged.
  The compiled-rule mirror stays frozen pending the Convergent Spine.

Also wires two workflow-only mechanisms (no package impact): a PR-time required
check (D1) that asserts the merge-config posture (`PR_TITLE` + `BLANK` + squash-only)
and fails loud on drift, then fails on any close-keyword ref not authorized by a
`totem-close` marker and persists the declared set as a receipt; and a
push-to-main reconciliation (D2) in OBSERVATION MODE that is content-scan-first +
body-presence-first under `BLANK` (RFC-822 attribution trailers stripped before
the presence test) — a marker-unauthorized anomaly / missing / ambiguous receipt
fails loud, a non-empty non-trailer keyword-free body surfaces as a non-failing
`unexpected-body` posture-drift warning — and never auto-reopens (the Tenet 9
sense→enforce gate).

Provenance: 1 confirmed instance (#2471→#2466) plus 4 asserted-prior
(undocumented). The Bash-matcher interlock (A) and `totem pr merge` wrapper (B)
are gated separately and not included here.
