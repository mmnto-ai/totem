# Dev journal — proof-kit fixture

## 2026-07-10 — notification flake

Investigated the notification retry flake. Sends fail intermittently but
nothing lands in the error log; tracking continues in issue #12.

## 2026-07-11 — root cause found

The legacy retry helper wraps transport.send in a try statement with an empty
catch — three weeks of send failures, swallowed. Quarantined the repro under
src/legacy/, banked the lesson, compiled the rule.
