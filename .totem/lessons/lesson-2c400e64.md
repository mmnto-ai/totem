## Lesson — An underivable gate read is not a wrapper failure

**Tags:** gates, docs, claude-code

On Claude Code a gate interlock's `deny` blocks at the strict tier and is only reported at the pilot tier. A read the gate itself cannot derive (merge-ready unable to reach GitHub) follows the tier as well, a `deny` under strict and a `warn` under pilot, except freeze-check, which fails closed at either tier. A failure of the wrapper itself (no resolvable CLI, the evaluation process failed, an unparseable verdict) blocks at either tier. A doc that says what blocks has to keep the two classes apart: the first draft of the Claude Code section folded them into one sentence and a reviewer caught it (mmnto-ai/totem#3006).
