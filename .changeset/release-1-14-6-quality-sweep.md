---
'@mmnto/totem': patch
---

Quality sweep Phase 1-2 and voice compliance fixes

**Voice compliance (3 PRs):**

- Reconcile lesson heading separator lint rules with parser flexibility (#1379, closes #1374). The compiler had produced a broken negative lookahead (`(?! .+[chars] .+)` instead of `(?! [chars] .+)`); hand-corrected.
- Strip em dashes from `totem lint` verdict and violation output (#1382, closes #1373). Updated README code-fence examples to match.
- Rename deprecated bare `totem extract` heading in cli-reference.md to canonical `totem lesson extract` (#1383, closes #1377).

**Quality sweep Phase 1 (#1387, closes #1380, #1352, #1355):**

- Archive 5 over-broad compiled rules and retire 1 duplicate lesson.

**Quality sweep Phase 2:**

- Escape glob wildcards (`*`) and underscores (`_`) in the export markdown renderer to prevent emphasis corruption in copilot/junie instruction files (#1388, closes #1386).
- Archive 2 over-broad `throw $ERR` rules that need compound `inside: catch` ast-grep constraints (#1389, closes #1218). Tagged with `upgradeTarget: compound` per Proposal 226.

**Postmerge (2 PRs):**

- 31 new lessons extracted from the 1.14.3-1.14.5 afternoon marathon and voice scrub PRs (#1384, #1385). 3 rules compiled (1 kept, 2 archived for over-breadth).
