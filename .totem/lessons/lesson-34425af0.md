## Lesson — When a CLI component uses special display modes (like

**Tags:** cli, ui, nodejs

When a CLI component uses special display modes (like a rotating quote spinner), ensure that the non-TTY fallback behavior matches the TTY behavior for common methods like `update()`. If a mode should suppress external updates in a terminal, it must also suppress them in CI/logs to maintain a consistent output stream.
