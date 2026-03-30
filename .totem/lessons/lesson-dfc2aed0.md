## Lesson — GitHub API responses often contain \r\n line endings, so

**Tags:** github-api, regex, node.js

GitHub API responses often contain `\r\n` line endings, so regex-based dividers must use `\r?\n` to prevent parsing failures on Windows-style or mixed line endings.
