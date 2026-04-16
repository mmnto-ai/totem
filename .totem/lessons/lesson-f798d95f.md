## Lesson — Include PID in temporary artifacts

**Tags:** filesystem, concurrency
**Scope:** .claude/hooks/**/*.sh

Suffixing artifact filenames with both a timestamp and PID prevents collision races when multiple hook events trigger within the same second.
