## Lesson — A derived-figure test needs a predicate-splitting fixture

**Tags:** testing, docs-transforms, fixtures, mutants, predicate, falsification-leg, bot-review, s6

**Applies-to:** boundary-test, presentation

A test of a derived figure needs a fixture where the injected predicate and a look-alike field test disagree, and a fixture for the figure's zero form. In S6 step 8 (mmnto-ai/totem#3066) the new BLOCKING_RULE_SET docs transform takes core's blocking predicate as a parameter, but the first test's fixture had only ast-grep rows at error severity, so a transform that ignored the parameter or mirrored an engine-field test passed every assertion (falsification read 1 F6, measured with a mutant harness: fieldMirror and coreIgnoreParam survived, ignoreActive and blockingBeforeActive were killed). The fold added an active regex error row so the honest rendering reads 3 of 4 and a mirror reads 2 of 4. CodeRabbit then found the committed-corpus assertions assumed a non-zero blocking set, so a valid all-advisory corpus would fail the test; the fix branched the assertions on the count and gave the none fixture an assertion on the provenance clause's zero branch. Rule: before claiming a renderer uses a predicate, run it on a fixture the predicate and its nearest look-alike split differently; before asserting a rendered count, cover the zero form.

**Source:** mcp (added at 2026-10-14T17:11:10.486Z)
