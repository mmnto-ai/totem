## Lesson — Load freeze instants from their source, never mint them

**Tags:** logic, temporal, validation
**Scope:** packages/cli/src/commands/spine-authored-materialize.ts

A producer that runs after the events it validates must load the freeze instant from its source of truth (the seed's frozen split), never stamp its own clock. Materialize runs after authoring, so any process-time frozenAt — captured early or late in the run — postdates every authoredAt and makes a frozenAt-precedes-authoredAt gate structurally unsatisfiable in production. Fail loud if the source instant is absent.
