---
name: review-reply
description: Unified PR review triage — fetch, normalize, and batch-action bot comments
---

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
- **GCA items:** DO NOT reply inline. Batch ALL GCA responses into ONE issue comment: `@gemini-code-assist` followed by a numbered list addressing each finding. Use `gh api repos/{owner}/{repo}/issues/$ARGUMENTS/comments --input -` with JSON payload.
- **SARIF items:** No reply needed (our own tool).

### `nit <numbers | category>`

Same as defer but reply text is "Acknowledged — nit / by design."

### `extract <numbers | category>`

For each selected finding, generate a lesson and call `mcp__totem-dev__add_lesson` (or equivalent):

- Use the bot's finding as the lesson body
- Add relevant tags from the file path and finding category
- The lesson will automatically get `lifecycle: nursery` treatment

### `done`

Print summary of actions taken and exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota and will NOT respond to replies unless they contain `@gemini-code-assist`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (`/issues/{pr}/comments`), not the review comments reply endpoint.
