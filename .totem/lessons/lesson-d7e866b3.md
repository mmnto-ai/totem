## Lesson — A page's claim that a check blocks the merge must match the ruleset's required checks

**Tags:** manual, docs, ci

A public page that says a CI check blocks the merge must match the repository ruleset, read from the API (gh api repos/<owner>/<repo>/rulesets/<id>), not the intent of the workflow: the maturity page said a lint receipt that stops reproducing blocks the merge, but the main ruleset required only the auto-close check, Build & Lint on three platforms and Totem Lint, so a red Docs Governance job stopped nothing through the GitHub UI and only the agent-side merge-ready gate read it. The cure for mmnto-ai/totem#2931 had repeated the claim in its own new sentence before the falsification leg checked the ruleset; the page now says the check fails. Verify a gating claim against the ruleset before writing it, and say the check fails unless the ruleset requires it.
