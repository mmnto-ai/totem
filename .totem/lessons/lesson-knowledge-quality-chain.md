## Lesson — The lesson pipeline has quality gaps at every transition

**Tags:** architecture, compiler, knowledge-quality

The knowledge pipeline (extract → lesson → compile → enforce) has no quality gates between steps. Each transition can degrade quality:

1. Extract: LLM decides what's worth learning from a PR. No filter for noise.
2. Lesson format: Fix guidance is optional. Many lessons diagnose the problem but don't tell the agent how to resolve it.
3. Compile: LLM generates AST/regex patterns from lessons. No self-test, no contradiction check against existing rules.
4. Curate: Manual review doesn't scale. We've reverted to the curated rule set three times.

Fix: Treat the pipeline like a compiler with type-checking at every stage. Validate required fields (heading, tags, body, Fix guidance) at write time. Validate compiled rules against test cases before promotion. Check for contradictions against the existing rule set. Each gate rejects invalid output instead of letting it flow downstream.
