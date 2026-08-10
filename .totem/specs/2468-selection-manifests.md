# Spec: mmnto-ai/totem#2468 — per-seat selection manifests (M1)

> NOTE: the auto-generated spec for this topic pattern-matched "selection manifest"
> onto the spine's `selection-rule.ts` / `PrSetDiff` machinery and described a
> rule-ID sync engine. That is not this issue. This spec is hand-corrected from
> the primary sources: the #2468 issue body, Proposal 308 (F1 envelope contract,
> F4 per-seat granularity, the refute condition), and the armed
> `mmnto-ai/totem-strategy:operations/467-serving-policy-preregistration.md`.

### Problem statement

Three consumers select context on a seat's behalf — the session-start hook
(always-injected tier), MCP `search_knowledge` (retrieval), and `totem orient`
(derived state) — and none of them records what it selected, what it excluded,
or what that cost. Proposal 308's falsifier and the #467 serving-policy pass
both need that record. Build a **read-only selection manifest** emitted per
selection event, keyed by content fingerprint. The M1 emitter is the **sole
blocker to #467 run 1**.

### Binding constraints (from the round + pre-registration)

1. **No shared relevance score, no common weights** (Prop 308 F1, unanimous;
   lc-codex refute condition). The manifest records each policy's own stated
   reasons. It is not a ranker and never adjudicates between policies.
2. **Senses, never gates** (Tenet 13). Emission must never block, filter, or
   alter a selection. Failure to emit degrades to a _recorded absence_, never a
   silent skip (#2466 failure class).
3. **Named aggregation** (#467 outcome 3's naming requirement): every emitted
   figure names its basis — the manifest declares it explicitly (UTF-8 bytes;
   approx tokens = ceil(bytes/4), declared as an approximation). What it emits
   is a **payload-byte census, NOT the ruled `<total>` basis** (measured
   cache-aware consumption); whether it may substitute for a `<total>` surface
   is the pre-registration's call via versioned revision (#467 §9), never this
   instrument's claim. (Corrected per leg round 1, D-6.)
4. **Per-seat, not per-repo** (F4): rows carry seat attribution
   (`agent_source` from `TOTEM_SELF_AGENT`, absent when unset — never guessed).
5. **Race note:** #2458 (federated dedupe, ~50% duplicated payload) is OPEN —
   the pre-fix baseline window is still obtainable. A race, not a gate.

### Files to examine (the real surfaces)

- `packages/core/src/ledger.ts` — event types, append conventions, `.totem/ledger/`
- `packages/core/src/qbd/record.ts` — the sensor-posture precedent (sense
  wrappers, `isInstrumentedProject`, attribution, accounting warnings)
- `packages/mcp/src/tools/search-knowledge.ts` — `performSearch`: floor
  withholding (disclosed), `federatedSearch` final-limit truncation (silent today)
- `packages/cli/src/commands/orient.ts` — `deriveOrientReport`,
  `renderOrientForSession` caps, the #2510 agent-invoked-only scope precedent
- `.claude/hooks/session-context.mjs` — the totem-repo V2 hook: journal
  (latest-file policy, 250-line cap), mail (10-item display cap), orient block,
  ticket-matched proposal (first-match-wins), vector context
  (`getAutoContext`, 6 000-char budget), global 10 000-char slice
- `packages/cli/src/commands/init-templates.ts` — `CLAUDE_SESSION_START` /
  `GEMINI_SESSION_START` published templates (describe + orient --session)
- `packages/cli/src/hooks/auto-context.ts` — `truncateResults` (char-budget cut)

## Implementation Design

### Scope

Ship the M1 instrument: a versioned, strict manifest schema + append-only
writer in core, and manifest emission from the three consumers (V2 hook + both
published SessionStart templates; `search_knowledge`; `totem orient`). It will
NOT: share any score across consumers, gate or alter any selection, carry an
`actuallyUsed` field (the usage join is analysis-side; the field arrives with
a `schemaVersion` bump when the analysis layer defines its semantics — the
`.strict()`-compatible evolution path, corrected per leg round 1 N-12), build
M2 threshold registration, or touch #2458 dedupe.

### Data model deltas

New module `packages/core/src/selection-manifest.ts` (sibling of `ledger.ts`):

- **`SelectionCandidate`** — `id` (repo-relative path or logical id, required) ·
  `sourceRepo?` · `fingerprint?` (sha256 hex, first 16 — of the exact bytes the
  policy considered; ABSENT when the policy never read the content, e.g.
  recency-excluded journal files, or on hash failure + warning) · `bytes?` /
  `approxTokens?` (same absence rule — a manifest never fabricates measurement
  work the policy didn't do) · `disposition: 'selected' | 'truncated' |
'excluded'` · `reason` (required; the policy's own words, e.g.
  `below-relevance-floor floor=0.250 relevance=0.198`, `recency-policy: only
latest journal injected`, `char-budget 6000`) · `deliveredBytes?` (truncated
  rows: what actually shipped).
- **`SelectionManifestRow`** — `schemaVersion: 1` · `timestamp` · `emitter:
'session-start' | 'search_knowledge' | 'orient'` · `session_id?` ·
  `agent_source?` · `cli_version` · `context` (per-emitter: query/boundary/
  floor/limits, branch/ticket, render mode) · `costBasis` (fixed literal:
  `{ bytes: 'utf8-length', approxTokens: 'ceil(bytes/4) approximation' }` —
  the #467 named-aggregation requirement) · `universe` (string naming the
  observable candidate pool, e.g. `store-returned-pool perStoreLimit=5` —
  the honest boundary: exclusions are recorded only over candidates the
  emitter actually saw; nothing is over-fetched to manufacture them, which
  would alter the measured thing) · `finalTruncation?` (`{cap, totalChars,
applied}` for the hook's 10k slice — string-level, not attributed
  per-candidate; declared limitation) · `candidates[]` · `warnings[]`.
- Zod schema **`.strict()`** at both levels — the refute-condition guard at the
  schema boundary: no shared-score field can be added without failing parse of
  existing rows and showing up in review.
- **Writer** `appendSelectionManifest(totemDir, row, onWarn)` + sensor wrapper
  `senseSelectionManifest(...)` (never throws), mirroring `qbd/record.ts`:
  `isInstrumentedProject` guard (no stray `.totem/` in non-projects),
  fire-and-forget `appendFileSync` to **`.totem/ledger/selection-manifests.ndjson`**
  (new file, gitignored via existing `.totem/ledger/` ignore; growth bounded
  the same way `events.ndjson` is — janitorial rotation is out of scope, parity
  declared).

### State lifecycle

No new in-memory state containers. Each manifest is built and appended within
one selection event; nothing persists across events except the append-only
file. Ownership: core owns the writer; each emitter owns assembling its own
row. The published `.cjs` templates inline a minimal append (same pattern as
their inlined `session_start` ledger write; template comment binds them to the
core schema, change-in-same-PR convention). The V2 hook imports the real
writer from the workspace dist like `pollMail`.

### Recorded-absence contract (the #2466 clause)

The denominator already exists in `events.ndjson`: `session_start` rows,
`mcp_call/search_knowledge` rows, `derive_action/orient` rows — all shipped and
emitted independently of this instrument. A denominator row with no matching
manifest row (join: `session_id` + emitter + timestamp proximity) IS the
recorded absence. A failed manifest write therefore cannot silently read as a
clean result; it additionally warns on the emitter's diagnostic channel.

### Failure modes

| Failure                                | Category    | Agent-facing surface                                                                                                    | Recovery                                            |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Manifest append fails (I/O)            | runtime     | warning on the emitter's accounting channel (stderr breadcrumb / `warnings[]`); absence detectable via denominator join | next event writes independently                     |
| Per-candidate hash failure             | runtime     | candidate kept with `fingerprint` absent + manifest `warnings[]` entry                                                  | per-candidate, isolated                             |
| No `.totem/` dir (not a Totem project) | init/normal | silent skip (`isInstrumentedProject` convention — normal state, not degradation)                                        | n/a                                                 |
| `session_id` / seat env absent         | normal      | field absent — stamped absence, never guessed (ADR-078); joins degrade honestly                                         | seat/hook config                                    |
| Writer throws (programming error)      | runtime     | sense wrapper converts to warning; selection output byte-identical                                                      | fix-forward; contract testable via throwing variant |
| Hook boot path failure                 | runtime     | existing boot-safety intact — manifest block inside the hook's own try, exit 0 preserved                                | next session                                        |

No silent-degradation row lacks a justification: the only silent path is the
not-a-Totem-project skip, same as QBD (nothing to instrument ≠ degradation).

### Emitter integration (altitude ruling)

Each emitter records at its own selection altitude; the overlap join
(`|injected ∩ retrieved| / |retrieved|`) needs corpus-content granularity, which
only the hook's journal/vector candidates and search hits carry. Fingerprints
of a whole injected file vs a retrieved chunk will not collide — `id` (path) is
the coarse join key, `fingerprint` the exact one; join policy belongs to the
measurement pass, declared, not solved here.

1. **`search_knowledge`** — assemble in `performSearch` at the finalize seam:
   returned hits → `selected` (bytes of `r.content`); below-floor withheld →
   `excluded` with floor+relevance in `reason`; federation overflow (the
   `reranked.slice(finalLimit)` cut, silent today) → surfaced via an out-param
   alongside the existing `failures` log, recorded `excluded:
'federation-final-limit'`. Write AWAITED after response composition (the
   `logCorpusQuery` precedent — the writer swallows its own failures).
2. **`totem orient`** — agent-invoked renders only (mirrors #2510's scope
   ruling: the machine-fired `--session` boot render is the _hook's_ selection,
   recorded there as one candidate). Candidates = report sections with derive
   errors as `excluded: 'derive-error: …'`; session caps recorded when the
   bounded render is agent-invoked (`--session` from a terminal is still
   hook-shaped: skipped, same reasoning).
3. **Session-start** —
   a. _V2 hook_: journal (enumerated filenames as id-only candidates; latest =
   `selected`/`truncated` with fingerprint+bytes; 250-line cap →
   `deliveredBytes`), mail (≤10 `selected`, overflow `excluded: display-cap`),
   orient block (one candidate), proposal (match `selected`, siblings
   `excluded: first-match-wins`), vector items (per-result metadata added to
   `AutoContextResult` — included vs `char-budget` omitted), plus
   `finalTruncation` for the 10k slice. Emitted just before stdout write,
   inside the existing try.
   b. _Published templates_ (Claude + Gemini): two candidates (describe block,
   orient block) with bytes — inline append, envelope untouched.

### Invariants to lock in via tests

- Emission is a pure sensor: with the writer forced to throw, `performSearch`
  output is byte-identical and a warning is surfaced (same probe shape for
  orient).
- Accounting completeness (search): `selected + withheld + federation-cut`
  candidate counts equal the observed pool; no candidate appears twice.
- Schema is strict: a row carrying any unknown top-level or per-candidate key
  fails parse (refute-condition guard); writer output round-trips.
- A fingerprint is computed over exactly the considered bytes: stable across
  identical content, changes when content changes; absent (with warning) when
  hashing fails — never a fabricated value.
- Attribution: env absent → fields absent (never `'claude'`, never guessed).
- Recorded absence: a failed append leaves the denominator row intact and the
  session functional (no throw), and the manifest file gains no partial row.
- Published-template contract: rendered `.cjs` contains the manifest block and
  the `hookSpecificOutput` envelope intact (extend the
  `gemini-sessionstart-contract` test pattern to both templates).
- `.totem`-less cwd: no directory materialized, no row written.
- (V2 hook is a repo-local script outside the package test rig — its manifest
  emission is live-probed by the falsification leg, declared here.)

### Build-time amendments (discovered during implementation, 2026-08-10)

1. **The V2 hook takes over A.3.a.** The recorded-absence denominator claim
   ("session_start rows ship independently") was FALSE for this repo: the
   bespoke `session-context.mjs` replaced the managed template without taking
   over its session-mint duty (measured live: 5 `session_start` rows vs 132
   `mcp_call`). The mint block lands with the instrument — it is the join key
   and the denominator on the seat where baseline sessions run.
2. **The Gemini template gets A.3.a too**, for the same reason — it never had
   the mint block, so its manifest rows would have had no session key and no
   denominator row.
3. **Template rows are schema-bound by test, not import:** the rendered `.cjs`
   templates hand-build rows; `sessionstart-manifest-contract.test.ts` parses
   every emitted row with the real strict schema, forcing template and schema
   to move in the same PR.

### Open questions

- **OQ1 — persistence surface.** Sidecar `selection-manifests.ndjson` vs rows
  in `events.ndjson`. **Recommendation: sidecar** — per-candidate arrays are
  bulky; the event stream's existing consumers (QBD scanner, stats) keep their
  scan economics; identical dir + conventions otherwise.
- **OQ2 — always-on vs config-gated.** **Recommendation: always-on sensor**
  (QBD precedent; a flag you must remember is the failure mode that costs the
  baseline — the #127 sidecar ruling's reasoning; cost is one append + a few
  sha256s per event).
- **OQ3 — orient scope.** Emit only on agent-invoked runs (mirror #2510) with
  the boot render recorded by the hook. **Recommendation: as stated** — orient
  is derived state, never corpus content, so per-item granularity buys the
  overlap number nothing.

### Verification (MANDATORY)

1. `totem lint` — zero violations; repo-wide `format:check`; workspace `pnpm -r build` + full test suite.
2. `totem review` advisory pass; the falsification leg is the review of record pre-merge.
3. Changeset: minor (new public core API + new emitter behavior).
