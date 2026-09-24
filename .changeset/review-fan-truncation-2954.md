---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem review` (and the pre-push review fan) cuts an over-window code diff on a boundary and says what it dropped (mmnto-ai/totem#2954). A filtered diff longer than the 50,000-char window used to be sliced wherever the count fell, mid-hunk or mid-line, and followed by a marker that named only the limit; a lane handed that payload could answer in a shape the shared verdict cascade cannot extract (measured on the strategy seat: the Gemini lane abstained exactly when the code diff was truncated and completed when it was whole, so a strict-tier push of a code PR over 50 KB could not be admitted). Now one helper, `truncateDiffForReview` in `shield-templates.ts`, serves every assembly site and the fan's delivered-segment fallback: the cut lands on the latest file or hunk boundary within the window (a line boundary when one hunk is wider than the window; a hard character cut only when the diff has no newline within it), and the marker names the delivered and total sizes, the boundary kind, the file shown in part and every whole file not shown (`... [diff truncated: N of M chars delivered, cut at a file boundary; 3 file(s) not shown: a.ts, b.ts, c.ts] ...`). A truncated prompt also carries a `=== DIFF TRUNCATION NOTICE ===` section AFTER the `<git_diff>` block (a template line, never content inside the untrusted block). The review command warns on the DELIVERED size after file filtering, naming the cut, where the resolver's warning speaks of the raw pre-filter diff (its text now says so). An unextractable lane abstention over a truncated payload names the cut in its persisted reason. The marker's head `... [diff truncated` is unchanged, so anything grepping for it still matches; the `diffHash` contract (the persisted `<git_diff>` bytes, marker included) holds through the shared helper.
