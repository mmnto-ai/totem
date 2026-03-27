# It Never Happens Again (The Learning Loop)

Every development team pays a hidden tax during code review: **The Bot-Tax** (and the Human-Tax).

When a reviewer (human or AI) spots an architectural mistake—like using a static import instead of a lazy one, or failing to tag an error properly—they leave a comment. The developer fixes it. The PR merges.

Two days later, an AI agent or a junior developer makes the exact same mistake in a different file. The cycle repeats. **Knowledge is trapped in merged PRs.**

Totem solves this with the **Extract → Compile → Enforce** loop. You turn a PR mistake into a permanent project law in under 60 seconds.

## 1. Extract the Lesson

When a PR review identifies a recurring issue, you don't just fix the code. You extract the principle.

Run the extraction pipeline against the PR:

```bash
totem extract <PR_NUMBER>
```

Totem reads the bot/human review comments, identifies the architectural fix, and writes a plain-English Markdown lesson to `.totem/lessons/`.

_Example output:_

```markdown
## Lesson — Lazy load CLI commands

Tags: architecture, cli
Never use static imports (e.g., `import fs from 'fs'`) at the top level of CLI command files. Always use dynamic imports (`await import('fs')`) inside the command handler to preserve startup latency.
```

## 2. Compile the Rule

Markdown is great for humans, but computers can't enforce prose.

Run the compiler:

```bash
totem compile
```

Totem's LLM engine reads the new lesson and synthesizes a deterministic **AST or Regex plugin** tailored specifically to your codebase. It saves this to `.totem/compiled-rules.json`.

_The AI is now out of the loop._

## 3. Enforce the Law

The next time any developer or AI agent tries to write a static import in a CLI file, they don't get a review comment. **They get blocked locally.**

```bash
$ git push
[Lint] Running rules...
### Warnings
- **packages/cli/src/commands/init.ts:1** — Lazy load CLI commands
  Pattern: `import fs from 'fs'`
  Lesson: "Never use static imports..."
[Lint] Verdict: FAIL — Fix violations before pushing.
```

## The Result

You never pay the "Bot-Tax" for that specific mistake again. You have effectively automated yourself out of the review loop for that class of error.

The mistake happened once. **It never happens again.**
