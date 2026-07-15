# Incident — three weeks of swallowed send failures (2026-06)

The legacy notification retry helper wrapped `transport.send` in a try
statement with an empty catch block. Every send error vanished without a log
line: nothing crashed, nothing alerted, and the failure mode stayed invisible
until users reported missing notifications — three weeks after the first
silent drop.

We quarantined the repro under `src/legacy/retry-2026-06.js`, banked the
lesson in `.totem/lessons/`, and compiled the rule this fixture now carries.

The repro stays in the tree on purpose: it is the compiled rule's positive
control — proof the pattern fires on the real historical shape, not just on
a synthetic example.
