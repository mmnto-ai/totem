# Git Hook Integration

Totem enforces its rules locally using Git hooks, preventing bad code from ever leaving the developer's machine.

You can install or update the hooks using:

```bash
totem hooks install
```

## Supported Hooks

- **`pre-commit`**: Fast checks for obvious violations.
- **`pre-push`**: Fast, local `totem lint` execution before pushing to a remote.
- **`post-merge` / `post-checkout`**: Re-syncs the local LanceDB index if lessons or rules have changed.
