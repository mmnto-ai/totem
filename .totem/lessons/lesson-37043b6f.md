## Lesson — Performing multiple string replacements in a loop

**Tags:** performance, typescript, strings

Performing multiple string replacements in a loop is inefficient due to repeated string allocations and traversals. Utilizing a single regular expression combined with a replacement map improves performance and maintainability when sanitizing large sets of terms.
