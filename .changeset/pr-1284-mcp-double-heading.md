---
'@mmnto/mcp': patch
---

Fix `add_lesson` MCP tool double-prepending `## Lesson —` heading (#1284)

When a caller passed a pre-formatted lesson to the `add_lesson` MCP tool whose body already started with a canonical `## Lesson — Foo` heading, the tool derived a title from the first line of the body — which included the literal `Lesson —` prefix — and produced a file with `## Lesson — Lesson — Foo` as the wrapper, with the original `## Lesson — Foo` still intact inside the body. The parser correctly read that as two separate lessons.

The tool now detects a pre-existing canonical heading (em-dash, en-dash, or hyphen variants, consistent with the parser fix in #1278), extracts the title, and strips the heading line from the body before wrapping. Callers who pass plain body text with no leading heading see unchanged behavior.

Closes #1284. Discovered during PR #1282 dogfooding.
