---
'@mmnto/totem': patch
---

Support tilde-fenced code blocks in lessons and compiler output (#1326)

CommonMark allows `~~~` as an alternate code-fence delimiter. Totem's lesson parser, compiler-response parser, drift detector, lesson linter, and suspicious-lesson detector were all hard-coded to recognize only triple-backtick fences, so any lesson authored with tilde fences silently lost its code blocks during extraction and compilation.

Seven files updated to match both fence styles. Every regex uses a capture group + backreference (`(```|~~~)...\1`) so opening and closing delimiters must match — mixing fence styles in a single block won't cross-match and produce garbage captures.
