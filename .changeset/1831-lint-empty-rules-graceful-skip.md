---
'@mmnto/cli': patch
---

`totem lint` skips gracefully when `compiled-rules.json` is empty (mmnto-ai/totem#1831).

Empty-corpus repos (e.g., aspirational pre-lessons setups like `totem-status`) used to hit a hard `NO_RULES` `TotemError` at `run-compiled-rules.ts:113-119` whenever a non-empty diff reached the lint runner. The runner now logs the empty-corpus state and returns an empty result so the caller exits cleanly. Behavior parity with the implicit no-op state of repos that never run `totem compile` and have no `compiled-rules.json` on disk — both paths now produce zero violations + zero exit code.

Consumers that need a "rule count > 0" CI guardrail can check `.totem/compiled-rules.json` rule count directly in their pipeline; the runner deliberately does not opinionate on that policy.

Bisection note: the strict throw was added in mmnto-ai/totem#1553 (2026-04-18) and shipped unchanged through 1.26.x and 1.27.0. mmnto-ai/totem#1831 framed it as a 1.28.0 regression based on consumer-side observation; the actual 1.28.0 change was an environmental shift (a non-empty diff reached the runner where prior CI passes had returned early via `getDiffForReview`). The behavior change here is the same regardless of framing.
