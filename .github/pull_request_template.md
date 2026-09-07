<!-- Totem PR template (mmnto-ai/totem#2823): the six headings every PR class here uses — feature, fix, chore, docs, gate. Fill each section and delete its guidance comment; keep the headings (CodeRabbit's description check reads them). Refs are repo-qualified: mmnto-ai/totem#NNNN. -->

## What

<!-- One paragraph, in the reader's terms: what changes and which issue it serves. -->

## How

<!-- The mechanism: what moved, where, and why this cure and not another. A bug fix names the root cause in one sentence before the fix. -->

## Verification

<!-- What you ran and what it said: the workspace build and test totals, `totem lint`, `format:check`, and the gate that covers this change. Tests: name each test added or changed and say why it would have FAILED on the pre-fix code; if none, say why verification logic does not apply here. -->

## Review leg (doctrine/model-tiering § Review legs)

<!-- A self-authored judgment-dense diff owes one falsification leg before it is presented: the deposit SHA, findings folded and findings declined with the reason. A mechanical diff: "not owed" and why. -->

## Not in this PR

<!-- What was deliberately left out to keep the diff bisectable, and where it is tracked. -->

## Related

<!-- Issues and PRs this touches, repo-qualified. To CLOSE an issue on merge, write two adjacent lines as one atom: first a bare-prose line made of the closing keyword (the word Closes) followed by the repo-qualified issue ref; directly beneath it an HTML comment whose text is the marker name totem-close, a colon, a space, and the hash-number of that same issue. Keep the keyword and any issue ref apart everywhere else in the body: the D1 autoclose guard (a required check) fails a closing keyword that has no marker, and GitHub closes on a closing keyword next to ANY issue reference even when the sentence negates it — so refer to issues you do not mean to close with "see" or "part of", not with a closing keyword. -->
