## Lesson — Standard markdown labels often place the colon inside

**Tags:** markdown, regex, parsing

Standard markdown labels often place the colon inside the bold markers (e.g., **Pattern:**), which differs from standard programming key-value formats. Parsers must account for delimiters appearing before formatting tokens to avoid capture failures on common bolding patterns.
