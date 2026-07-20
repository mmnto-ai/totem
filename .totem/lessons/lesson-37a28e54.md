## Lesson — Handle null process exit codes gracefully

**Tags:** node, process, validation
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Node's child process close events can emit null exit codes and signals. Classifying these strictly as normal process exits can violate schema constraints and silently suppress failure logging.
