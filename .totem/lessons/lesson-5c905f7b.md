## Lesson — When using stdio: 'pipe' with the GitHub CLI, set

**Tags:** cli, node.js, github-cli

When using `stdio: 'pipe'` with the GitHub CLI, set `GH_PROMPT_DISABLED=1` to prevent indefinite hangs caused by the process waiting for terminal input that is no longer accessible.
