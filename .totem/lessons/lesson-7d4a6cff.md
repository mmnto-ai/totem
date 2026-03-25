## Lesson — Frontmatter delimiters must be anchored to the start

**Tags:** regex, parsing, yaml

Frontmatter delimiters must be anchored to the start of the line to prevent '---' sequences within YAML scalars from being misinterpreted as the end of the block.
