## Lesson — Wrap external calls in timeouts

**Tags:** bash, performance, git
**Scope:** .claude/hooks/**/*.sh

Wrap all git and external invocations in `timeout` or `gtimeout` to ensure the hook never hangs the parent process during execution.
