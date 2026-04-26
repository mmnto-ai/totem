## Lesson — Honor source scope over LLM emission

**Tags:** compiler, llm, glob
**Scope:** packages/core/src/compile-lesson.ts

Source-declared scope declarations must take precedence over LLM-generated globs to prevent the silent loss of manual exclusion patterns like test file filters.
