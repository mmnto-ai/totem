## Lesson — A replay script's exit code carries the tree identity and the coverage

**Tags:** manual, testing, replay, migration

A replay script compares the checkout's head with the pinned tree and fails on an unreadable in-scope file; printing the head and the unreadable count is disclosure, not enforcement. A script that exits on pattern disagreements alone passes on the wrong tree — measured: exit 0 against main where the pinned tree was required, with a different file and line count in its output (mmnto-ai/totem#2948, a bot finding verified by measurement; tracked on mmnto-ai/totem#2952).
