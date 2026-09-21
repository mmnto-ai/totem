---
name: review-reply
description: Unified PR review triage — fetch, normalize, and batch-action bot comments
---

<!-- totem:skill-start -->

Triage PR review comments from all bots for PR $ARGUMENTS.

## Before Phase 1: confirm each invoked bot's review is on the head

A review trigger is the operator's to post, and what a bot does with it is not ours to control — so before triaging, confirm every invoked bot's review against the review object for THIS head sha, or the bot's summary comment for that sha, never a green commit status on the head: CodeRabbit's status settles green on every push head whether or not it reviewed that head (`Review completed` on the sha it reviewed, `Review skipped` on every push head it did not), and a PENDING status means still reviewing; Greptile's green `Greptile Review` check run does mark the sha it reviewed; GCA posted neither a status nor a check run on any GCA-reviewed sha measured so far. The reads, in order — the head sha; every review with the sha it was submitted against; the sha each Greptile summary comment names as its `Last reviewed commit`; the sha each CodeRabbit summary comment names as covered in its `final_review_risk_coverage` marker — so both halves compare a printed sha against a printed head, never an improvised one:

```bash
gh pr view $ARGUMENTS --json headRefOid --jq .headRefOid
gh api --paginate "repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews" --jq '.[] | [.user.login, .commit_id, .state, .submitted_at] | join(" ")'
gh api --paginate "repos/{owner}/{repo}/issues/$ARGUMENTS/comments" --jq '.[] | select(.user.login == "greptile-apps[bot]") | .body | capture("Last reviewed commit:.*?/commit/(?<sha>[0-9a-f]{40})") | .sha'
gh api --paginate "repos/{owner}/{repo}/issues/$ARGUMENTS/comments" --jq '.[] | select(.user.login == "coderabbitai[bot]") | .body | capture("coveredCommitId.:.(?<sha>[0-9a-f]{40})") | .sha'
```

A summary-comment verdict is read from the PR's issue comments and matched to the head by the `Last reviewed commit` sha its own body names — never by the comment's timestamp, which an in-place re-review does not advance. A chat reply or silence with no review to confirm is not a pass under the cadence of one external pass per chosen bot, so the pass is a standalone re-trigger, posted by the operator on the same terms — that bot's first pass, not a re-invoke, which the cadence reserves for risky rework with the reason recorded in the round comment. Before merging on the other reviewers, either wait one acknowledgement window (about 12 minutes from the trigger) or merge and record the late acknowledgement as one line on the PR thread naming the bot and the time it acknowledged.

## Phase 1: Fetch & Categorize (Deterministic)

Run the triage command to fetch, normalize, deduplicate, and categorize all bot comments:

```bash
pnpm exec totem triage-pr $ARGUMENTS
```

`pnpm exec` is the documented explicit form: it puts `node_modules/.bin` first on the path and runs the `totem` bin from there. A bare `pnpm totem …` reaches the same bin only as a fallback — pnpm tries a builtin command first, then a declared `totem` script, and hands the name to `pnpm exec` only when it finds neither — so the explicit form is the one to run; a Windows consumer once saw a `cmd` banner instead of the triage on the bare form (mmnto-ai/totem#2903, one occurrence, not reproduced since). From an installed `@mmnto/cli`, `node node_modules/@mmnto/cli/dist/index.js triage-pr $ARGUMENTS` is the same triage with no resolver in between; in a checkout whose workspace build is the intended binary, `node packages/cli/dist/index.js triage-pr $ARGUMENTS`.

This outputs a categorized inbox grouped by blast radius (Security → Architecture → Convention → Nits) with cross-bot deduplication already applied. The heavy lifting is done in TypeScript — no LLM math needed.

**STOP HERE.** Present the output to the user and wait for them to specify actions. Do NOT proceed to Phase 2 until the user replies.

## Phase 2: Execute Actions (Bulk Support)

The user may type individual IDs (e.g., `fix 4, 11`) OR use bulk actions:

- `fix all security`
- `defer all nits`
- `extract all architecture`

### `fix <numbers | category>`

Mark items as will-fix. No API calls — just acknowledge. The user will make code changes next.

### `defer <numbers | category> [ticket]`

Auto-reply on the PR acknowledging the deferral:

- **CodeRabbit items:** Reply inline to each thread with "Tracked in #NNN" or "Deferred — not blocking for this PR."
- **GCA items:** DO NOT reply inline. Batch ALL GCA responses into ONE issue comment: `@gemini-code-assist` followed by a numbered list addressing each finding. Use `gh pr comment $ARGUMENTS --body-file -` and pipe the comment body via stdin.
- **ghcq items:** `github-code-quality[bot]` has no known @-listener (attested: no in-org tag attempt has drawn a response and none is documented — mmnto-ai/totem#2626) — do not tag it; treat its dispositions as audit-trail-only.
- **SARIF items:** No reply needed (our own tool).

### `nit <numbers | category>`

Same as defer but reply text is "Acknowledged — nit / by design."

### `extract <numbers | category>`

For each selected finding, generate a lesson and call `mcp__totem-dev__add_lesson` (or equivalent):

- Use the bot's finding as the lesson body
- Add relevant tags from the file path and finding category
- The lesson will automatically get `lifecycle: nursery` treatment

### `done`

Print a summary of actions taken, then — when the round is being dispositioned — assemble and post the single consolidated round-disposition comment (see the section below), which EXECUTES `totem review --covariate` to carry the `local-lane:` line, on the operator's explicit go. Then, as the LAST action of the round, run `totem resolve-threads` (step 4 of that section) — dry first, `--apply` only on the operator's explicit go. Then exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota and will NOT respond to replies unless they contain `@gemini-code-assist`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (`/issues/{pr}/comments`), not the review comments reply endpoint.

## Consolidated round-disposition comment (a concrete step, operator-gated)

Disposing the round is ONE consolidated comment (single-comment ownership per bot-protocols) — a real, numbered step of the flow, NOT an optional aside. Like every GitHub mutation in this skill it is operator-gated: assemble the body, show it, and post ONLY on an explicit human go. Run this as part of `done` (or whenever the operator asks to post the round disposition):

1. **Obtain the covariate line — execute the verb, never hand-author it.** Run the read-only, zero-LLM command and capture its stdout:

```bash
totem review --covariate
```

It resolves the current branch lineage exactly as the review fan does and prints the canonical `local-lane:` line from the core-owned renderers — the LATEST verdict artifact's line (`.totem/artifacts/verdicts/`) when the current diff is admitted, or the exact-identity admission record's `not-applicable` form (`.totem/artifacts/admissions/`, format v1.1, mmnto-ai/totem#2473) when the current diff is a deterministic skip — never trust a pasted or hand-copied value. Under format v1.2 (mmnto-ai/totem#2698) every shape carries the appended `leg: <sha8> blocking=<n> material=<n> folded=<n>` field (or `leg: none`), and a lineage with no artifact of either family but a leg deposit for HEAD prints the `local-lane: none` head shape — carry whatever the verb prints, verbatim. If it reports no line at all, there is none to carry (note that in the body and continue).

2. **Assemble the single body.** One comment: @-tag EVERY bot addressed in the round — exactly ONE tag each (e.g. `@gemini-code-assist`, `@coderabbitai`, `@greptileai`) so each bot registers the disposition, each tag on its OWN line (operator-ruled 2026-09-15; the line shape is practice, not a GCA guarantee, and position within the comment is unruled), and tags must be present when the comment is POSTED, never edited in (GCA's listener fires on comment-created only). One notification per bot per round: a bot with nothing addressed gets no tag, and a bot already @-tagged in this round's batch comment (the GCA defer/nit batch above) is NOT re-tagged here. ghcq (`github-code-quality[bot]`) has no known listener — it is never tagged; its items are dispositioned in the body for the audit trail only (mmnto-ai/totem#2626). Never combine a tag with ANY bot's review trigger — triggers are standalone comments, one trigger and no prose (a trigger embedded in a content-rich comment chat-routes the bot). Then the per-item dispositions (fixed / deferred / nit / extracted), then ONE machine line per bot-rooted thread this round answered, each on its own line —

```text
disposition: <rootCommentId> <fixed|declined|deferred|nit|extracted|held>
```

— where `<rootCommentId>` is the thread root's REST comment id, the `id=` on the row `totem resolve-threads $ARGUMENTS` prints in its dry run — run that dry run NOW, before assembling: it is read-only, it lists every thread with its id whether or not this comment exists yet, and it runs again after posting as step 4's evidence check (`totem triage-pr` carries the id but does not print it) — and the verb is this round's word for that thread. The merge-ready gate's predicate 4 (mmnto-ai/totem#2861) reads a RESOLVED HIGH/Major inline as dispositioned only when a non-bot PR-level comment created after its root carries the line naming ITS id (or a non-bot reply sits in the thread): a round disposition that omits a thread's line leaves that HIGH applying to the head, a line naming another thread does not discharge it, and a line edited into an older comment does not count — post a new comment for a late line. A finding outside any thread (a review-body item, a summary-table row) has no line: it has no thread to resolve. Then the non-empty `local-lane:` line from step 1, verbatim. The local `review-loop` holds this line but never posts it, so `/review-reply` is the SOLE path that carries it to GitHub.

3. **Post on an explicit go.** Show the assembled body and wait for the operator; on their go, post the ONE comment with `gh pr comment $ARGUMENTS --body-file -` (pipe the body via stdin). Never mutate the PR autonomously.

4. **Resolve the threads this round dispositioned — dry first, `--apply` on the operator's explicit go.** The comment you just posted IS the evidence the verb reads, so this step runs AFTER it, and it is the LAST action of the round. Print the plan (this never mutates):

```bash
totem resolve-threads $ARGUMENTS
```

Every bot-rooted thread prints one row carrying its REST root comment id and a verdict: `resolve`, `skip:already-resolved`, `skip:outdated`, `skip:no-evidence`, `skip:not-selected`. A `skip:no-evidence` row is a thread this round has not answered — neither an in-thread reply from a human nor a PR-level comment created after that thread's root — and the verb will NEVER resolve it under any flag; give it evidence and re-run rather than working around it. Show the plan and wait. Only on the operator's explicit go, run the mutating half (add `--ids <comma-separated REST root comment ids>` to narrow it to named rows; an unmatched id aborts before anything is resolved):

```bash
totem resolve-threads $ARGUMENTS --apply
```

The verb never posts a comment, a reply or a review — the only mutation it can issue is `resolveReviewThread`, which is what the merge-ready gate's unresolved-bot-threads predicate reads. Exit `2` means it did not do everything asked (an unmatched id, a failed mutation, or a selected thread with no evidence); exit `1` means the read did not complete and NOTHING was resolved. Report what it printed, verbatim.

A clean `--apply` run is NOT an allow verdict, and it clears the unresolved-bot-threads predicate only when no unresolved, non-outdated thread rooted by a known review bot remains: a `skip:no-evidence` row stays unresolved and, under `--apply`, makes the run exit 2; a run narrowed with `--ids` leaves its unnamed rows as `skip:not-selected` and exits 0. The gate re-reads the PR when `gh pr merge` runs, and a bot HIGH inline whose commit cannot be read makes the evaluation UNEVALUABLE once every earlier predicate passes — a deny the resolve run does not predict (under the pilot tier it warns; strict denies). After the apply, read the floor itself — `totem gate check --event merge-ready --payload '{"repo":"<owner/repo>","pr":$ARGUMENTS}'`, with `--tier pilot` where the installed gate is the pilot — and report that verdict beside the resolve rows, before the merge word is asked for.

<!-- totem:skill-end -->
