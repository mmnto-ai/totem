## Lesson — Instead of re-running a test suite to show failure logs,

**Tags:** git-hooks, performance, testing

Instead of re-running a test suite to show failure logs, capture stdout/stderr to a temporary file during the first run and display it on error to avoid doubling execution time.
