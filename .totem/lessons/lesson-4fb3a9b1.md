## Lesson — When implementing post-processing for LLM outputs, use

**Tags:** llm, architecture, regex

When implementing post-processing for LLM outputs, use prompt constraints as the primary filter to avoid building complex recursive parsers. A simple "safety net" sanitizer is often preferable to a robust parser if it covers all historically observed patterns while minimizing code complexity.
