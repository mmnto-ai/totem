## Lesson — Doc regen LLMs persist phantom references

**Tags:** architecture, llm, documentation

LLM-powered document regeneration creates a self-reinforcing hallucination loop: the LLM reads its own prior output as context, sees stale issue numbers or closed ticket references, and faithfully reproduces them in the new version. Each regen cycle reinforces the phantom data. Fix: include explicit negative constraints in the doc target description (e.g., "only reference OPEN issues") and validate generated docs against live issue state.
