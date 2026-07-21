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
  reconciler (`reconcile`), and the E-lever posture assertion
  (`evaluateMergeConfigPosture`). Presence invariant, zero semantics: any
  close-keyword-adjacent ref is an anomaly (genuine, negated, quoted, emphasized
  alike — no negation parser). Qualified `owner/repo#N` refs match too; comment
  bodies are never scanned. Intended closures ride `closingIssuesReferences` or a
  structured `<!-- totem-close: #N -->` marker.

- **CLI** extends the hand-written hook templates (`init-templates.ts`) — the
  Claude PreWriteShield and the Gemini BeforeTool parity surface — to block
  close-keyword-adjacent refs in `**/*.md` writes (EXEMPT `.github/**`), sharing
  core's `AUTO_CLOSE_REGEX_SOURCE`. No new managed session hook; the roster is
  unchanged. The compiled-rule mirror stays frozen pending the Convergent Spine.

Also wires two workflow-only mechanisms (no package impact): a PR-time required
check (D1) that asserts the repo merge-config posture (`PR_TITLE` + `BLANK`, the
E lever) and fails loud on drift, then fails on any undeclared close-keyword ref
and persists the declared set as a receipt; and a push-to-main reconciliation
(D2) in OBSERVATION MODE that is body-presence-first under `BLANK` — a
close-keyword-bearing anomaly / missing / ambiguous receipt fails loud, a
non-empty-but-keyword-free body surfaces as a non-failing `unexpected-body`
posture-drift warning — and never auto-reopens (the Tenet 9 sense→enforce gate).

Provenance: 1 confirmed instance (#2471→#2466) plus 4 asserted-prior
(undocumented). The Bash-matcher interlock (A) and `totem pr merge` wrapper (B)
are gated separately and not included here.
