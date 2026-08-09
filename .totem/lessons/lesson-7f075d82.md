## Lesson — if this template ever gains a stdin-reading step

**Tags:** trap, git-hooks, pre-push, stdin, template, conditional-rule, lfs

**Applies-to:** infrastructure

CONDITIONAL DESIGN RULE — pre-push hook template + stdin: a pre-push hook receives the pushed-refs list ONCE on stdin; the first `while read` consumer starves every consumer after it (single-consumption stream). LC live-fired this in their own hook extensions: `git lfs pre-push` chained after a stdin-reading step got EOF and silently uploaded nothing — 39 dangling LFS pointers (LC lesson-79ba5529, mmnto-ai/liquid-city#968 era, 2026-08-08). Census as of 1.114.0 (verified on the rendered strategy-repo hook, 2026-08-09): the totem-managed pre-push template reads NO stdin, so the trap cannot fire in any composition involving totem's block — downstream stdin readers appended by consumers receive the full stream. THE RULE: if this template ever gains a stdin-reading step (enumerating pushed refs) or chains multiple stdin readers, the capture pattern is mandatory IN THE TEMPLATE — capture once at the top (STDIN_CAPTURE=$(cat)), feed each consumer from the variable, never let step order decide who gets the stream. Do not add the capture defensively before the condition fires (Tenet 21); this lesson is the trigger-coupled guard.

**Source:** mcp (added at 2026-08-09T01:14:03.662Z)
