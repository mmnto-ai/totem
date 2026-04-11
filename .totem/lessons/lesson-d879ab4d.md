## Lesson — Use shell-safe snippets for timeout tests

**Tags:** testing, node, windows
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*, !**/*.spec.*

When passing a `-e` script to a Node subprocess that runs through Windows cmd.exe (`shell: true`), avoid arrow functions. The `=>` token is parsed as `=` followed by `>` (output redirection), which sends stdout to a file named after the next token (e.g. `{}`). Use any callable without `=>` as the keep-alive callback — a plain `function() {}` is the most idiomatic form; `setInterval(Object, ms)` also works because `Object` is a no-op callable. The principle is the important part: no `=>` in shell-routed `-e` strings on Windows.
