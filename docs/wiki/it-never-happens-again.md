# It Never Happens Again

When a reviewer (human or AI) spots an architectural mistake, like a static import that should be lazy or an error without a proper tag, they leave a comment. The developer fixes it. The PR merges.

Two days later, an agent or a junior developer makes the exact same mistake in a different file. The cycle repeats. Knowledge is trapped in merged PRs.

Totem breaks this cycle with a three-step loop: **Extract → Compile → Enforce.** You turn a PR mistake into a permanent, mechanically enforced rule in under 60 seconds.

## 1. Extract the Lesson

When a PR review identifies a recurring issue, extract the underlying principle. The fix alone won't close the loop.

```bash
totem extract <PR_NUMBER>
```

Totem reads the review comments, identifies the architectural pattern, and writes a plain-English Markdown lesson to `.totem/lessons/`.

_Example output:_

```markdown
## Lesson - Lazy load CLI commands

Tags: architecture, cli
Never use static imports (e.g., `import fs from 'fs'`) at the top level of CLI command files. Always use dynamic imports (`await import('fs')`) inside the command handler to preserve startup latency.
```

## 2. Compile the Rule

Markdown is readable by humans but not enforceable by machines.

```bash
totem compile
```

Totem's compiler reads the lesson and generates a deterministic AST or regex rule tailored to your codebase. The rule is saved to `.totem/compiled-rules.json`.

From this point forward, no LLM is involved in enforcement.

## 3. Enforce the Rule

The next time any developer or AI agent tries to write a static import in a CLI file, the pre-push hook blocks locally:

```bash
$ git push
[Lint] Running 394 rules (zero LLM)...
### Errors
- **packages/cli/src/commands/init.ts:1** — Lazy load CLI commands
  Pattern: `import fs from 'fs'`
  Lesson: "Never use static imports..."
[Lint] Verdict: FAIL — Fix violations before pushing.
```

No review comment. No back-and-forth. The violation is caught before the code leaves the developer's machine.

## The Result

The mistake happened once. It was extracted, compiled, and enforced. The same class of error is now mechanically impossible to merge, regardless of whether the author is a human, Claude, Gemini, or Cursor.
