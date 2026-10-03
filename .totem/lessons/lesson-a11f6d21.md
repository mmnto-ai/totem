## Lesson — A doc must say when CI's lint step is advisory

**Tags:** docs, ci, enforcement

This repository's CI runs the compiled-rules lint with `continue-on-error` while the rule-compilation freeze stands: the step reports findings and does not fail the check. The run that blocks is the pre-push hook. The first draft of the Claude Code section said the rules are enforced by the pre-push hook and CI; a reviewer caught it, and the three docs now say the hook enforces and CI reports (mmnto-ai/totem#3006).
