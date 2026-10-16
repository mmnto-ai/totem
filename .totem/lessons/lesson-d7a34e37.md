## Lesson — before "settled", require PR head = pushed sha AND check

**Tags:** merge-ready, github-api, stale-head, gates, sensor-trust, trap

**Applies-to:** infrastructure

The merge-ready gate judges the pull-request RECORD's head, which can lag the pushed branch tip for minutes. After the push of 031f2219 to the mmnto-ai/totem#3084 branch (2026-10-14, about 23:57Z) GitHub's branch and compare endpoints held the tip while the pull-request record stayed at 319a96d7 for over twelve minutes: no synchronize event, no check run, no workflow run, githubstatus.com all operational; `totem gate check --event merge-ready` answered allow twice against the stale head ("17/17 checks green"). The catch was comparing the sha the gate printed with the sha pushed. An empty commit forced the synchronize, CI ran on it, the gate allowed the new head with the payload's headSha equal to the local head, and the merge followed. Rule: before "settled", require PR head = pushed sha AND check runs present on that head; the verb's payload headSha is evidence, not a predicate (a mismatch prints one notice line and never denies). The hardening is mmnto-ai/totem#3086 (an UNEVALUABLE arm comparing headRefOid with the branch ref's tip read in the same query); the pagination twin is lesson-df854a67.

**Source:** mcp (added at 2026-10-16T00:49:53.817Z)
