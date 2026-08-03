---
name: review-reply
description: Unified PR review triage — fetch, normalize, and batch-action bot comments
---

<!-- totem:skill-start -->

Triage PR review comments from all bots for PR $ARGUMENTS.

## Phase 1: Fetch & Categorize (Deterministic)

Run the triage command to fetch, normalize, deduplicate, and categorize all bot comments:

```bash
pnpm totem triage-pr $ARGUMENTS
```

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
- **SARIF items:** No reply needed (our own tool).

### `nit <numbers | category>`

Same as defer but reply text is "Acknowledged — nit / by design."

### `extract <numbers | category>`

For each selected finding, generate a lesson and call `mcp__totem-dev__add_lesson` (or equivalent):

- Use the bot's finding as the lesson body
- Add relevant tags from the file path and finding category
- The lesson will automatically get `lifecycle: nursery` treatment

### `done`

Print a summary of actions taken, then — when the round is being dispositioned — assemble and post the single consolidated round-disposition comment (see the section below), which EXECUTES `totem review --covariate` to carry the `local-lane:` line, on the operator's explicit go. Then exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota and will NOT respond to replies unless they contain `@gemini-code-assist`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (`/issues/{pr}/comments`), not the review comments reply endpoint.

## Consolidated round-disposition comment (a concrete step, operator-gated)

Disposing the round is ONE consolidated comment (single-comment ownership per bot-protocols) — a real, numbered step of the flow, NOT an optional aside. Like every GitHub mutation in this skill it is operator-gated: assemble the body, show it, and post ONLY on an explicit human go. Run this as part of `done` (or whenever the operator asks to post the round disposition):

1. **Obtain the covariate line — execute the verb, never hand-author it.** Run the read-only, zero-LLM command and capture its stdout:

```bash
totem review --covariate
```

It resolves the current branch lineage exactly as the review fan does, loads the LATEST verdict artifact for that lineage (`.totem/artifacts/verdicts/`), and prints the canonical `local-lane:` line from the single core-owned renderer — never trust a pasted or hand-copied value. If it reports no verdict for the current lineage, there is no line to carry (note that in the body and continue).

2. **Assemble the single body.** One comment: the per-item dispositions (fixed / deferred / nit / extracted) followed by the non-empty `local-lane:` line from step 1, verbatim. The local `review-loop` holds this line but never posts it, so `/review-reply` is the SOLE path that carries it to GitHub.

3. **Post on an explicit go.** Show the assembled body and wait for the operator; on their go, post the ONE comment with `gh pr comment $ARGUMENTS --body-file -` (pipe the body via stdin). Never mutate the PR autonomously.

<!-- totem:skill-end -->
