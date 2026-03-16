# CI/CD Integration

This guide details how to integrate Totem into your automated pipelines, ensuring your Codebase Immune System actively blocks architectural regressions before they merge.

## The Shield GitHub Action

The most common integration is running `totem lint` on pull requests. Because it uses the `compiled-rules.json` file, this check requires **zero API keys**, runs entirely locally, and executes in milliseconds.

Totem natively outputs in SARIF 2.1.0 format, which integrates seamlessly into the GitHub Advanced Security tab, annotating the exact lines of code where a rule was violated.

### Example Workflow (`.github/workflows/shield.yml`)

```yaml
name: Totem Shield
on:
  pull_request:
    branches: [main]

jobs:
  deterministic-shield:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: Build Project
        run: pnpm build # (Or your equivalent build step)

      - name: Run deterministic shield
        # The shield command will evaluate the diff against compiled rules
        # and output the results as a SARIF file.
        run: npx @mmnto/cli lint --format sarif > totem-results.sarif

      - name: Upload SARIF results
        # This action reads the SARIF file and posts the findings
        # directly to the PR's "Files Changed" tab.
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: totem-results.sarif
```

## CI Drift Testing

If your team modifies the Totem instruction files (e.g., `CLAUDE.md`, `GEMINI.md`), you should add a drift test to ensure those files haven't exceeded the length limits (FR-C01) or lost the core `search_knowledge` reflexes.

A standard Vitest test can assert the line count and presence of required strings, failing the pipeline if a developer accidentally bloats the agent config.

## Handling False Positives in CI

If the CI pipeline fails due to a `totem shield` rule that is technically correct but contextually wrong (a false positive), developers do not need to modify the ruleset.

They can bypass the rule using an inline suppression directive directly in the code:

```typescript
// totem-ignore-next-line
const myLegacyPath = 'src/legacy/data.json';
```

_(Note: Our Flight Rules dictate that every `totem-ignore` should be accompanied by a follow-up ticket to address the technical debt)._
