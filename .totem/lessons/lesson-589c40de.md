## Lesson — Avoid naive regex for Markdown markers

**Tags:** markdown, parsing, regex
**Scope:** packages/cli/**/*.ts

When scanning for managed-span markers without a markdown parser, a marker counts only as a whole line: quoted in an inline code span, mentioned mid-sentence, indented as code, or inside a CLOSED fenced block it is prose and is skipped. Below a fence that never closes, or inside or below an HTML comment that reaches a marker, the marker is AMBIGUOUS — a quotation the author never closed, a comment that swallows a marker, or a real span under a stray opener — so neither the refresh nor the eject guesses: nothing from that line on is touched and the opener's line is named so it can be closed. Scan fences and comments in ONE sequential block pass, the way a renderer reads them (a comment opener inside an open fence is fence content; a fence-looking line inside a comment is raw HTML, not a fence), and disclose the remaining limit (a fence-looking line inside any other raw HTML block) rather than embedding a parser. Guessing either way was the destructive-rewrite path the floor's legs kept finding (mmnto-ai/totem#2871).
