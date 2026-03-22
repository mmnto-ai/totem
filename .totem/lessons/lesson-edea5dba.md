## Lesson — Use anchored regex for shell command matching

**Tags:** regex, security, automation

When triggering actions based on shell command strings, use anchored regex (e.g., `^\s*git\s+`) rather than loose keyword matching. Loose patterns can trigger accidentally on file paths or comments that happen to contain the command keywords (like `.git/hooks`).
