## Lesson — AST-based rules often use empty strings for regex patterns,

**Tags:** typescript, regex, architectural-patterns

AST-based rules often use empty strings for regex patterns, which causes `new RegExp('')` to match every line if passed to a regex engine. Always explicitly filter rules by engine type before execution to prevent these latent false-positive bugs.
