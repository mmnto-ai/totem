## Lesson — Isolate closing keywords from issue references

**Tags:** github, automation, regex
**Scope:** .github/pull_request_template.md

GitHub's parser can trigger accidental issue closures even when prose negates the closing keyword. PR templates must describe closing syntax using placeholders and keep keywords strictly separated from references to prevent triggering autoclose guards.
