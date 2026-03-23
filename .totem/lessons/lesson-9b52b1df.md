## Lesson — Simple string lookups like indexOf('[{') fail to detect

**Tags:** llm, json, parsing

Simple string lookups like `indexOf('[{')` fail to detect pretty-printed JSON; using a regex search for `\[\s*{` ensures the parser correctly identifies the start of an array regardless of whitespace.
