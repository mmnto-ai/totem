## Lesson — Using split() on markdown headings often misclassifies

**Tags:** typescript, regex, parsing

Using `split()` on markdown headings often misclassifies the first section as a preamble or loses the heading text itself. Utilizing `matchAll` to capture heading indices allows for precise slicing of content blocks without losing metadata or specific section titles.
