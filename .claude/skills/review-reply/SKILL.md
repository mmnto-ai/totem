---
name: review-reply
description: Unified PR review triage — fetch, normalize, and batch-action bot comments
---

Triage PR review comments from all bots for PR $ARGUMENTS.

## Phase 1: Fetch

Fetch comments from all three GitHub API endpoints. Use `--paginate` on all calls.

```bash
# 1. Inline review comments (CR, GCA, SARIF)
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --paginate

# 2. PR-level comments (CR summary, GCA summary, totem-lint)
gh api repos/{owner}/{repo}/issues/$ARGUMENTS/comments --paginate

# 3. Review bodies (CR nits live in collapsed <details> sections)
gh pr view $ARGUMENTS --json reviews --jq '.reviews[] | select(.body != "") | {author: .author.login, state: .state, body: .body}'
```

## Phase 2: Normalize

Parse each comment and classify by bot:

| Bot Username                    | Severity Signal                                                                  | Source                  |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| `coderabbitai[bot]`             | `🔴 Critical`, `🟠 Major`, `🟡 Minor` in body                                    | inline + review body    |
| `gemini-code-assist[bot]`       | `security-high-priority.svg`, `high-priority.svg`, `medium-priority.svg` in body | inline + issue comments |
| `github-advanced-security[bot]` | SARIF severity in body                                                           | inline                  |
| `<!-- totem-lint -->` marker    | Our managed comment — skip for triage                                            | issue comments          |

For CodeRabbit review bodies: expand `<details>` sections and extract nitpick items. These are often the most valuable findings but easy to miss.

Deduplicate: if multiple comments from the same bot target the same file+line, group them.

Filter out:

- Bot boilerplate/summary headers (CR "Walkthrough", GCA "Summary of Changes")
- Already-resolved threads (check for `<!-- review_comment_addressed -->` markers in replies)
- Your own replies (author matches the repo owner)

## Phase 3: Present

Show a structured triage table:

```
PR #934 — 17 comments from 3 bots (9 distinct findings)

 #  | Bot   | Sev    | Source      | File:Line              | Finding
 1  | CR    | Major  | inline      | frontmatter.ts:11      | Anchor FRONTMATTER_RE
 2  | CR    | Major  | inline      | lesson-io.ts:115       | Invalid YAML fallback
 3  | CR    | Minor  | review nit  | pr-comment.ts           | Consider renaming param
 4  | GCA   | High   | inline      | lesson-io.ts:94        | console.warn in core
 5  | SARIF | Warn   | inline x5   | lesson-io.ts:94        | (5 rules, deduplicated)
 ...

Actions: fix <#>, defer <#> [ticket], nit <#>, extract <#>, done
```

**STOP HERE.** Present the table and wait for the user to specify actions. Do NOT proceed to Phase 4 until the user replies with their triage decisions. Do NOT start fixing code or replying to bots unprompted.

## Phase 4: Execute Actions

### `fix <numbers>`

Mark items as will-fix. No API calls — just acknowledge. The user will make code changes next.

### `defer <numbers> [ticket]`

Auto-reply on the PR acknowledging the deferral:

- **CodeRabbit items:** Reply inline to each thread with "Tracked in #NNN" or "Deferred — not blocking for this PR."
- **GCA items:** DO NOT reply inline. Batch ALL GCA responses into ONE issue comment: `@gemini-code-assist` followed by a numbered list addressing each finding. Use `gh api repos/{owner}/{repo}/issues/$ARGUMENTS/comments --input -` with JSON payload.
- **SARIF items:** No reply needed (our own tool).

### `nit <numbers>`

Same as defer but reply text is "Acknowledged — nit / by design."

### `extract <numbers>`

For each selected finding, generate a lesson and call `mcp__totem-dev__add_lesson`:

- Use the bot's finding as the lesson body
- Add relevant tags from the file path and finding category
- The lesson will automatically get `lifecycle: nursery` treatment

### `done`

Print summary of actions taken and exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota (33 reviews/day) and will NOT respond to replies unless they contain `@gemini-code-assist`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (`/issues/{pr}/comments`), not the review comments reply endpoint.

## CRITICAL: Pagination

All `gh api` calls MUST use `--paginate`. PRs can have 100+ comments across the three endpoints. Without pagination, you'll silently miss findings.
