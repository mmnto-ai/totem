## Lesson — Development tools that programmatically manage system files

**Tags:** security, devtools, git-hooks

Development tools that programmatically manage system files like .git/hooks often trigger their own security rules when referencing those paths in strings. These alerts should be demoted to warnings within the installer logic to prevent legitimate configuration code from being flagged as malicious activity.
