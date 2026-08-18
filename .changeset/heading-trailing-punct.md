---
'@mmnto/totem': patch
---

`generateLessonHeading` / `truncateHeading`: the word-boundary cut no longer leaves punctuation attached to the final word (the strategy#1060 GCA-mined exhibit — a heading ending "…contamination class,"). Trailing commas/semicolons/colons/dashes strip iteratively inside the fragment-trim loop, so a stripped comma that exposes a dangling conjunction ("…runs, and,") collapses cleanly too.
