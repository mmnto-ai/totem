## Lesson — Tree-sitter S-expression queries often lack predicates

**Tags:** tree-sitter, ast, regex

Tree-sitter S-expression queries often lack predicates to check child counts, making empty multi-line blocks difficult to detect. Use regex to target common single-line patterns until the engine supports custom predicates for node counts.
