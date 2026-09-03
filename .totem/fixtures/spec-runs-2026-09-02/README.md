# Fixture: `totem spec` run artifacts (2026-09-02)

A committed, sha256-pinned dataset derived from the 55 retained `totem spec` run
artifacts in the resident checkout's artifact store. Read-only derivation: the
exporter never writes to the source store and never mutates git.

## Provenance

| | |
|---|---|
| Source store | `D:/Dev/totem/.totem/artifacts/runs/*.json` (gitignored, per-checkout) |
| JSON files scanned | 158 |
| Selected | 55 (`admission.runMetadata.caller === 'spec'`) |
| Not selected | 81 `caller: 'review'`, 22 with no `caller` |
| Exported at | 2026-09-02, from worktree `round-1193/measurements` at `8d5e2691` |
| Exporter | [`scripts/export-fixture.mjs`](scripts/export-fixture.mjs) |

### Index pin (context, not a dependency)

The resident index manifest at export time: `writtenAt` **2026-09-02T20:48:59.843Z**,
`gitCommit` **8d5e2691**, embedder **gemini / `gemini-embedding-2-preview`, 768-d**.

**This fixture is independent of that index.** Every field is derived from the
recorded run artifacts alone — the artifact JSON and the resident repo's git
history. Nothing here is re-retrieved, re-embedded, or re-scored, so the fixture
does not change if the index is rebuilt, re-embedded, or discarded. The pin is
recorded only so a later reader knows which index state produced the *retrieval
hits that the runs recorded*.

## Census

**55 artifacts = 31 issue-anchored + 24 topic-anchored** (classified by the first
anchor in the prompt; see *Multi-anchor runs* below).

| Axis | Counts |
|---|---|
| `schemaVersion` | `1.1.0` ×30, `1.2.0` ×25 |
| `backend.provider` | `gemini` ×55 |
| `backend.qualifiedModel` | `gemini-3.5-flash` ×34, `gemini-3.1-pro-preview` ×21 |
| schema × model | 1.1.0/pro ×21, 1.1.0/flash ×9, 1.2.0/flash ×25 |
| anchor × schema | issue/1.1.0 ×18, topic/1.1.0 ×12, issue/1.2.0 ×13, topic/1.2.0 ×12 |
| `backend.admissionClass` | `completion_only` ×55 |
| `backend.taskProfile` | `Spec` ×55 |
| `admission.runMetadata.codeBlind` | `false` ×50, absent ×5 |
| `output.metrics.finishReason` | `STOP` ×55 |
| `createdAt` range | 2026-06-11T22:53:37.907Z .. 2026-09-02T01:04:00.649Z (all 55 distinct) |
| Tokens | 173,315 input / 102,729 output (totals) |
| `durationMs` | min 11,205 · median 27,578 · max 69,071 |
| Issue anchors | 33 across 31 artifacts · `State: OPEN` ×32, `CLOSED` ×1 |
| Issue label counts | 0 labels ×13, 1 ×1, 2 ×14, 3 ×3 |
| Query expansion | 11 of 55 queries matched `TEST_KEYWORD_RE` (`expanded !== raw`) |
| `mainCommitAtRun` | 47 distinct commits over 55 runs (approximate — see caveats) |

### Retrieval delivered per run — exactly 8 hits

Every run delivered **8** retrieval hits: **5 spec/ADR + 3 code**, with no
exceptions across all 55 (275 spec + 165 code = 440).

`grounding-items.ndjson` (440 rows, `sourceType` `spec` ×275 / `code` ×165) and
the `deliveredHits` parsed out of the prompt text agree row-for-row on counts and
section split — the grounding bundle *is* the delivered context, recorded twice
by two independent paths in the producer.

The `RELATED SESSION HISTORY` and `RELEVANT LESSONS (HARD CONSTRAINTS)` sections
that `assemblePrompt` can emit are **absent from all 55 prompts** — no run
retrieved a session or a lesson.

## Files

| File | Bytes | Rows |
|---|---|---|
| `artifacts.ndjson` | 1,084,822 | 55 |
| `grounding-items.ndjson` | 118,318 | 440 |
| `SHA256SUMS` | — | one row per file in this directory (re-sealed after every round record landed) |
| `scripts/export-fixture.mjs` | — | — |

`SHA256SUMS` covers **every file in this directory except itself** — the two data
files, every round record, every file under `scripts/`, and this README (it is line 1
of the sums). Verify with `sha256sum -c SHA256SUMS` from this directory.

> **Concurrency note.** At export time a second, unrelated stream was writing its
> own scripts into `scripts/` (`r1-retrieve.mjs`, `r2-referents.mjs`,
> `r3-structured-probe.mjs`). Because `SHA256SUMS` covers every file under
> `scripts/`, those files are pinned too, and the sums go stale whenever that
> stream rewrites one. Re-run the exporter to re-pin.

## Field dictionary — `artifacts.ndjson`

One JSON object per line, sorted by `createdAt` ascending (ties by `id`).

| Field | Meaning |
|---|---|
| `id` | Artifact filename stem — the 64-hex sha the store names the run by. |
| `schemaVersion` | Artifact schema version, as recorded. |
| `createdAt` | Run timestamp, ISO-8601 Z, as recorded. |
| `backend` | `{provider, model, qualifiedModel, admissionClass, taskProfile}` verbatim. |
| `inputHash` | As recorded. |
| `admission` | `{runMetadata:{caller, codeBlind?}}` verbatim. |
| `mainCommitAtRun` | `git rev-list -1 --before=<createdAt> main` in the resident repo. **Approximate** — see caveats. |
| `mainCommitAtRunIsApprox` | Always `true`. Present so no consumer can read the field above as exact. |
| `anchor` | `{kind: 'issue'\|'topic', ref}` for the **first** anchor. `ref` is the bare `#<n>` form for an issue, the trimmed topic text for a topic. |
| `anchorCount` | Number of anchors in the prompt (1 for 51 runs, 2 for 4). |
| `anchors[]` | Every anchor in prompt order: `{kind, ref}` plus `{number, title, labels, state}` on issue anchors. |
| `issue` | First issue anchor: `{number, title, labels[], state, bodyMasked}`; `null` when the run had none. |
| `topic` | Trimmed topic text when `anchor.kind === 'topic'`; `null` otherwise. |
| `query.raw` | The retrieval query **rebuilt** from the recorded prompt. See caveats. |
| `query.expanded` | `expandSpecQuery(raw)` — `raw + TEST_EXPANSION` when `TEST_KEYWORD_RE` matches, else `raw`. |
| `query.source` | Always `'rebuilt-from-maskedPrompt'`. |
| `deliveredContext` | `{knowledge, specs, code, helpers}` — the text between each of the four context marker lines and the next marker (or end), trimmed. |
| `deliveredHits[]` | `{section, label, filePath, score}` parsed from the hit-header lines. |
| `output` | `{content, metrics{inputTokens, outputTokens, durationMs, finishReason}}` verbatim. |
| `outputSha256` | sha256 (hex, utf-8) of `output.content`. |
| `promptSha256` | sha256 (hex, utf-8) of `inputBundle.maskedPrompt`. |
| `grounding` | `{hash, provenanceSummary, items}` — `items` is `grounding.bundle.items` verbatim (8 per artifact). |

### `grounding-items.ndjson`

440 rows, `{artifactId, index, provenance, contentHash, sourceType, filePath}`.
No item carried a field outside that set. `provenance` is `similarity-only` for
all 440; every artifact's `grounding.provenanceSummary` is `"similarity-only:8"`.

### How `query.raw` is rebuilt

Mirrors `packages/cli/src/commands/spec.ts` (`buildSearchQuery` line 111,
`expandSpecQuery` line 145, `QUERY_BODY_TRUNCATE = 500`): one query part per
input in input order, joined with a single space, then expanded.

- issue part: `` `${title} ${labels.join(' ')} ${bodyMasked.slice(0, 500)}`.trim() ``
- topic part: the topic text as recorded

```js
const TEST_KEYWORD_RE =
  /\b(test(?:s|ing)?|verif(?:y|ies|ication)|example(?:s)?|fixture(?:s)?|hits|misses|rule-?tester)\b/i;
const TEST_EXPANSION = ' test testing infrastructure fixture verification testRule rule-tester';
```

`labels[]` is recovered by splitting the prompt's `Labels: ` line on `", "`
(comma + space — the separator `assemblePrompt` writes via
`issue.labels.join(', ')`); `(none)` means no labels.

### Delivered-hit line formats

Two distinct shapes appear, both produced by the CLI, not by the model.

**`specs` and `code`** — `formatResults` (`packages/cli/src/utils.ts:319`),
non-condensed. A hit header, then the snippet on continuation lines indented by
exactly two spaces, blank line between hits:

```
- **Git Hook Integration > Supported Hooks** (docs/wiki/hook-integration.md, score: 0.027)
  - **`pre-commit`**: Fast checks for obvious violations.
```

Only the *unindented* `- **` lines are hits; the two-space indent on every
snippet line (`snippet.replace(/\n/g, '\n  ')`) is what keeps a snippet that
itself starts with `- **` from being misparsed. All 440 headers parsed.

**`helpers`** — `formatSharedHelpers` (`packages/core/src/sys/helpers.ts:79`), a
four-line block per helper with no path and no score, so it yields zero
`deliveredHits`:

```
**safeExec** — Cross-platform shell execution with error handling and timeout support
  Import: `import { safeExec } from '@mmnto/totem';`
  Signature: `safeExec(command: string, args?: string[], options?: SafeExecOptions): string`
  Instead of: child_process.execSync or child_process.spawnSync
```

This block is **byte-identical across all 55 runs** (single sha256 over the
section text) — it is a hardcoded list, carrying no per-run signal.

**`knowledge`** is empty in all 55: `=== TOTEM KNOWLEDGE ===` is a wrapper banner
whose immediate next line is the `=== RELATED SPECS & ADRs ===` banner. The four
markers are not siblings — specs and code nest under knowledge.

## Caveats

1. **`mainCommitAtRun` is an approximation.** The artifact records no commit, so
   this is the last `main` commit dated before `createdAt` in the resident repo.
   It is not proof of the tree a run saw: the run may have executed on a feature
   branch, on a dirty tree, or on a checkout behind `main`. `--before` compares
   committer dates, which are not monotonic across merges. 47 distinct commits
   cover the 55 runs, so several runs share a value. Treat it as a coarse
   temporal locator, never as the run's input tree.

2. **`query.raw` is rebuilt from the masked prompt, not captured.** The producer
   did not record the query, so it is reconstructed from the recorded prompt. It
   is therefore faithful to the *recorded input* — including secret masking and
   the 500-char body truncation — and not necessarily to the live issue: the
   issue's title, labels, state or body may have changed since the run, and a
   masked span in the body reached the real query unmasked. A label containing
   `", "` would also split wrongly on recovery (none observed).

3. **Issue title/body come from the masked prompt**, so they are the masked
   forms. Where the mask fired, the fixture holds the placeholder, not the
   original bytes.

4. **Two runs carry upstream escape corruption in the recorded issue text**, not
   introduced here. Artifact `4d666857…` has a literal CR (0x0D) inside the title
   of mmnto-ai/totem#2189 (`… wire diff-replay into \` + CR + `un + S4 …`, from an
   undecoded `\r`), and artifact `da927720…` has a literal TAB (0x09) inside the
   body of mmnto-ai/totem#2141 (`\` + TAB + `otem-codex`, from an undecoded `\t`).
   Both are reproduced byte-for-byte: `bodyMasked` is a verbatim substring of the
   source prompt and `promptSha256` recomputes over the source. A parser over
   these fields must not assume `.`-matchable titles — JS `.` does not match CR.

5. **Multi-anchor runs (4 of 55).** `totem spec` accepts several inputs in one
   run, and 4 artifacts carry two anchors each:

   | Artifact | First anchor | Second anchor |
   |---|---|---|
   | `da927720…` | issue mmnto-ai/totem#2141 | issue mmnto-ai/totem#2144 |
   | `940ec4c9…` | issue mmnto-ai/totem#2167 | issue mmnto-ai/totem#2137 |
   | `d2c00686…` | issue mmnto-ai/totem#2644 | topic `board-pagination` |
   | `353b28b8…` | topic (see below) | topic `board-truncation` |

   The recorded `anchor.ref` for an issue is the bare `#<n>` form, not the
   qualified form shown above. `anchor` names the first anchor; `anchorCount` and
   `anchors[]` carry the rest, and `query.raw` joins every part exactly as
   `spec.ts` does. Classifying by the first anchor is what yields 31 issue / 24
   topic.

   Note the last row: the first anchor's topic text is the bare hash form of
   mmnto-ai/totem#2644 typed as a raw input. `spec.ts` does **not** parse that as
   an issue (it requires an all-digits input, a URL, or `owner/repo#N`), so it was
   retrieved as free text — the run is topic-anchored and the fixture records it
   that way.

6. **No `record`-arm runs.** The `--from` bound-record anchor
   (`=== RECORD <path> (sha256 …) ===`, mmnto-ai/totem#2700) postdates this
   cohort; the exporter parses it and would flag it as an anomaly, but zero
   occurred.

## Secret scan

Every byte of both `.ndjson` files was scanned **before** either file was
written; on any hit the exporter writes nothing, prints the artifact id and the
pattern name (never the matched value), and exits 1.

Patterns: Google API key (`AIza…`), Anthropic key (`sk-ant-…`), OpenAI-style key
(`sk-…`), GitHub PAT classic (`ghp_…`) and fine-grained (`github_pat_…`), PEM
private-key header, Slack token (`xox[abp]-…`), and assigned-credential
(`api_key|secret|token|password` followed by `:`/`=` and a quoted 16+ char
value, case-insensitive).

**Result: 0 hits over 1,197,454 bytes.**

The upstream producer masks with `maskSecrets`
(`packages/core/src/sanitize.ts`), which emits `[REDACTED]` and
`[REDACTED_CUSTOM]`. The fixture contains **2 × `[REDACTED]`** and **0 ×
`[REDACTED_CUSTOM]`**.

## Re-running the export

```
node D:/Dev/worktrees/totem-totem-claude-r1193/.totem/fixtures/spec-runs-2026-09-02/scripts/export-fixture.mjs
```

Deterministic given the same source store and the same resident git history.
Set `TOTEM_FIXTURE_RESIDENT` to point at a different resident checkout; output
always lands in the exporter's parent directory. Verify a checkout with:

```
sha256sum -c SHA256SUMS
```

## Round records added on top of the export (mmnto-ai/totem-strategy#1193, totem-claude lens)

All produced on the same checkout at the same pin; scripts under `scripts/` regenerate each from the files above and the resident index.

| file | what | produced by |
|---|---|---|
| `r1-queries.ndjson` | the 55 rebuilt queries (raw + expanded), a cross-check of the exporter's `query` field | `scripts/r1-retrieve.mjs` |
| `r1-retrieval.ndjson` · `r1-norms.json` · `r1-cost.json` · `r1-summary.md` | re-retrieval of every query at the pin through the built `retrieveContext` (production hybrid path) plus the raw vector/FTS legs; stored-vector and query-vector norms; the SDK distance-metric determination (squared L2); overlap vs the historical bundles; cost | `scripts/r1-retrieve.mjs` |
| `r1-preregistration.md` | R1 arms, units, denominator and pass/refute conditions, written before any label existed | seat |
| `r1-rerank.ndjson` · `r1-rerank-cost.json` | three delivered sets per query (production baseline; local cross-encoder `Xenova/bge-reranker-base` over the raw pools; the query re-embedded as `RETRIEVAL_QUERY`) with every pool item's cross-encoder score | `scripts/r1-rerank.mjs` (needs a scratch `node_modules` with `@huggingface/transformers`; nothing is added to the workspace) |
| `r1-candidates.ndjson` · `r1-candidates-blind.ndjson` · `r1-label-rubric.md` | the union of delivered chunks per query with text; the arm-blind, per-query-shuffled labelling file; the rubric | `scripts/r1-blind-candidates.mjs` |
| `r1-labels-part{0,1,2}.ndjson` · `r1-score.json` | per-pair relevance labels (0/1/2) by three Opus legs; precision@k per arm and the verdicts against the pre-registration | legs · `scripts/r1-score.mjs` |
| `r1-results.md` · `r1-diagnostics.json` | the R1 results table judged against the pre-registration, and the diagnostics quoted in it (score separation AUCs, per-partition label mix, arm overlap, cost percentiles on the 31, the CE query-asymmetry split) | seat · `scripts/r1-diagnostics.mjs` |
| `r2-referents.ndjson` · `r2-referents-summary.md` (+ `.literal.*`) | mechanical referent extraction from every draft, resolved at the run commit and at HEAD | `scripts/r2-referents.mjs` |
| `r2-labels-part{0,1,2}.ndjson` · `r2-labels.ndjson` · `r2-labels.summary.json` · `r2-summary.md` | the hand-adjudicated confabulation labels (CONFABULATED / PARTIAL / GROUNDED / EMPTY) with cited checks | three Opus adjudication legs, seat spot-check |
| `r2-faithfulness-*.ndjson` · `*.summary.json` | RAGAS 0.4.3 `Faithfulness` per draft, one file per judge (local Ollama `qwen3-coder:30b`; `gemini-3.5-flash`) | `scripts/r2-ragas-faithfulness.py` (a scratch venv; see the script docstring for the pins) |
| `r3-structured-probe.json` · `r3-*-run*.md` · `r3-summary.md` | the structured-output probe: one issue-anchored prompt regenerated unconstrained / `responseSchema` / `responseJsonSchema`+`minLength`, checked with the pre-commit reader's TEMPLATE predicate | `scripts/r3-structured-probe.mjs` |
