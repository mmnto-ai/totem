# Spec: A2 reproducible proof kit + A3 machine-derived maturity table

> **Provenance note:** the `totem spec` LLM output for this slug hallucinated an unrelated
> "A2 path-normalization" problem (#1582 class — the slug carried no issue body). This file
> replaces it. The binding spec is the ruled strategy#531 dispatch
> (`processed/2026-07-14T2242Z-totem-claude-531-ruled-totem-lane-routing.md`, ruling record
> mmnto-ai/totem-strategy#531 comment 4974679759).

### Problem statement

The strategy#531 marketing round ruled two totem-lane build artifacts, sequenced after the
seam-repair burn-down (landed as #2367):

- **A2 — reproducible proof kit:** committed tiny fixture repo + CI; a real repo-specific
  mistake → lesson/compiled rule → blocked recurrence; every public timing/perf number
  recomputes from the fixture; the asciinema recording is an output of it, not a staged demo.
- **A3 — machine-derived maturity table:** Shipped / Partial / `Goal:` rows coupled to code
  or committed data, behind the docs-as-governed-surface track (strategy#639) — not an
  ungoverned Makefile. Receipts trio ruled in: compiled-rule count + provenance chain,
  days-under-freeze, real-diff zero-LLM lint receipt. ECL gets an honest row
  (shipped · local-only · multi-seat opt-in), excluded from headline mechanism billing.

**Copy bounds (ruled):** no public layer taxonomy; purge list — no Spine vocabulary, no
"Governance OS" / fleet / shared-cognition / auto-healing language, no competitor roster,
no implementation counts without a user outcome. The split-register conformance-copy
constraint is RETIRED (premise falsified; #2369 built the contract line).

### Grounding (verified this session)

- `docs:inject` = `tools/docs-inject.cjs` + `md.config.cjs` + `tools/docs-transforms.cjs`
  (RULE_COUNT, HOOK_LIST, CHMOD_HOOKS, COMMAND_TABLE; all fail-loud, deterministic).
  Lesson 93aad741: curated pages never LLM-generated; inject for derivable values.
- `.totem/compiled-rules.json`: `{version, rules[485]{lessonHash, engine, compiledAt, …}, nonCompilable}`.
- `.totem/freeze.json`: `rule-compilation`, `since: 2026-05-17`; do-not list bars editing
  `.totem/lessons/**`, running `totem lesson compile`, hand-editing `compiled-rules.json`.
  Freeze reason is corpus-specific (safe-regex2 gate vs the xrepo-qualify-refs lookbehind).
- Public timing numbers: README "under 2 seconds" (lines 14, 125); wiki "60 seconds"
  (it-never-happens-again.md, linked README:171).
- No existing "receipt" concept in `packages/**` — new artifact class.
- CI surfaces: `.github/workflows/ci.yml` (Build & Lint 3-OS), `lint.yml`, `totem-doctor.yml`.

## Implementation Design

### Scope

Ship A3 as a deterministic, CI-gated docs surface (new wiki page + committed data + four
`docs:inject` transforms + a drift job), and A2 as a committed fixture kit + CI workflow that
mechanically re-proves the blocked-recurrence loop and recomputes the public timing numbers.
Explicitly NOT: no Prop-297 coverage-manifest/currency-class build-out (that's the #639
track proper), no `totem docs` CLI changes, no new LLM calls in any CI path, no README hero
rewrite (A1 is strategy-claude's lane), no edits to `.totem/lessons/**` or
`compiled-rules.json`, no new GitHub repo unless ruled.

### Data model deltas

| New artifact                                                                                                  | Holds                                                                                                                                | Written by                                                                                                 | Read by                                                                | Invariants                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/data/maturity.json`                                                                                     | rows: `{id, mechanism, status: shipped\|partial\|goal, anchors[]{kind: file\|command\|config-key\|data, ref}, headline: bool, note}` | humans, via PR                                                                                             | MATURITY_TABLE transform + its test                                    | every row ≥1 anchor; every anchor must resolve at inject time (fail loud); closed status vocabulary; ECL row pinned `status: shipped`, `headline: false` (test-locked, 2–1 micro-split ruling)                                                                                  |
| `docs/data/lint-receipt.json`                                                                                 | `{baseSha, headSha, filesScanned, rulesEvaluated, violations, elapsedMs, llmCalls: 0, cliVersion, generatedAt, env}`                 | `tools/gen-lint-receipt.mjs` (runs workspace `totem lint` over a pinned REAL merged-PR range of this repo) | LINT_RECEIPT transform; CI recompute job                               | `llmCalls` must be literal 0; counts must match CI recompute (timing is env-labeled, not gated)                                                                                                                                                                                 |
| 4 transforms in `tools/docs-transforms.cjs`: MATURITY_TABLE, RULE_PROVENANCE, DAYS_UNDER_FREEZE, LINT_RECEIPT | pure functions, no module state                                                                                                      | —                                                                                                          | `md.config.cjs`, rendered into `docs/wiki/maturity.md` (+ README link) | RULE_PROVENANCE derives count from `rules.length` (never hardcoded); DAYS_UNDER_FREEZE derives from `freeze.json since` and hard-errors if the entry is absent (freeze lift ⇒ deliberate PR retires the row)                                                                    |
| `examples/proof-kit/**` (A2)                                                                                  | fixture app source; fixture-own `.totem/` (lesson + committed compiled rule); `mistake.diff`; run scripts; `receipt.json` (timing)   | this PR; regenerated by kit scripts                                                                        | `.github/workflows/proof-kit.yml`; wiki timing claims                  | the mistake exists ONLY as a `.diff` artifact, never as applied source in the tree; fixture lesson corpus lives under `examples/proof-kit/`, disjoint from the frozen root `.totem/lessons/**`; fixture rule's `lessonHash` must equal the fixture lesson's hash (chain intact) |

No new types/fields in `packages/**` product code. No reserved keys; `headline` is an
explicit field, not a sentinel.

### State lifecycle

All new state is **committed files** (persistent; mutation owned by PRs — the governed-docs
property). CI materializes the proof-kit fixture into a runner temp dir per job (created at
job start, destroyed with the runner; nothing persists back except uploaded artifacts:
asciinema cast + recomputed receipt). No runtime state containers, no cross-lifecycle flags.

### Failure modes

| Failure                                            | Category              | Agent-facing surface                                               | Recovery                                                           |
| -------------------------------------------------- | --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `maturity.json` missing/malformed/unknown status   | init                  | hard error, inject exits 1                                         | fix data in PR                                                     |
| Anchor unresolvable (file moved, command renamed)  | runtime               | hard error naming row+anchor — this IS the staleness sensor firing | PR updates row (or honestly demotes status)                        |
| `compiled-rules.json` / `freeze.json` missing      | init                  | hard error (existing RULE_COUNT pattern)                           | restore committed data                                             |
| Freeze entry absent after lift                     | permanent (by design) | hard error at inject                                               | deliberate PR retires/rewrites the days-under-freeze receipt       |
| Docs drift (inject output ≠ committed page)        | runtime               | new CI job fails with diff                                         | run `pnpm docs:inject`, commit                                     |
| Receipt recompute mismatch (counts)                | runtime               | proof-kit/docs CI job fails                                        | regenerate receipt; if counts legitimately moved, PR updates it    |
| `mistake.diff` no longer applies (fixture drifted) | runtime               | proof-kit CI hard fail                                             | update diff with fixture                                           |
| Lint does NOT block the applied mistake            | runtime               | proof-kit CI hard fail — the load-bearing assertion                | product regression; investigate before any copy ships              |
| Lint blocks the CLEAN fixture (false positive)     | runtime               | proof-kit CI hard fail                                             | fix rule/fixture                                                   |
| Timing exceeds published bound on runner           | transient             | proof-kit CI fail (generous margin), receipt env-labeled           | rerun; if persistent, the public number changes — that's the point |

No silent-degradation rows (Tenet 4 clean).

### Invariants to lock in via tests

- Every maturity row's every anchor resolves against the working tree; unknown status or
  anchor kind rejects.
- The ECL row exists, reads `shipped · local-only · multi-seat opt-in`, and is excluded
  from headline billing (`headline: false`) — mechanical lock on the ruled micro-split.
- Rendered maturity output contains none of the purge-list vocabulary (content-assert, the
  #2349/#2367 parity-test pattern).
- RULE_PROVENANCE count always equals `rules.length` of the committed file; never a literal.
- LINT_RECEIPT renders "zero LLM calls" only from `llmCalls === 0` in committed data.
- Proof-kit: mistake applied ⇒ lint exits non-zero AND the firing rule's `lessonHash`
  equals the fixture lesson hash; clean fixture ⇒ lint exits 0.
- No source file in `examples/proof-kit/` matches the mistake pattern (the mistake stays
  diff-only).

### Open questions

1. **A2 fixture home** — **Options:** (a) in-repo `examples/proof-kit/` + workflow
   (reversible, no new shared state, CI proves it on every push); (b) standalone public repo
   (more legible as "a real consumer" for marketing; needs operator provisioning + becomes
   another governed surface). **Recommendation:** (a) now; graduate later if A1 wants the link.
2. **Freeze boundary for A2's compile step** — the demo's lesson→rule compile would run the
   legacy compiler against the FIXTURE's own tiny corpus (temp dir / recorded session only,
   never in CI, never this repo's corpus). The do-not list says "run `totem lesson compile`"
   unqualified; I read it as corpus-scoped (the freeze reason is corpus-specific), but this
   needs an explicit ruling. **Options:** (a) permit fixture-scoped compile, recorded
   locally, CI stays zero-LLM with the committed rule; (b) no compile anywhere — kit ships
   the committed rule only, recording shows lesson-authoring + lint-blocking (weakens the
   "→ compiled rule →" middle of the ruled loop). **Recommendation:** (a).
3. **Sequencing** — **Options:** A3 PR first (fully in-repo, deterministic, no open
   provisioning questions) then A2; or A2 first per dispatch listing order.
   **Recommendation:** A3 first, A2 immediately after its rulings land.
4. **A3 vehicle** — **Options:** (a) repo-local `docs:inject` transforms + CI drift gate
   (Prop 297 names these as the GENERATED-class binding; smallest governed slice);
   (b) lift into the `totem docs` CLI surface now (product-izes it; cross-package scope
   creep ahead of the #639 track). **Recommendation:** (a).
5. **A2's anchor mistake** — needs one REAL repo-specific mistake with history.
   **Options:** the GitHub auto-close-keyword-in-narrative-markdown class (#1762 lineage —
   real accidental upstream issue closure, regex-compilable, tells well); the fail-open
   catch class; the atomic-write temp-suffix class. **Recommendation:** the auto-close
   keyword class.
