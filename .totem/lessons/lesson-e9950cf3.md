## Lesson — Lesson — Shell variable quoting: don't quote multi-word

**Tags:** shell, hooks, trap, posix

## Lesson — Shell variable quoting: don't quote multi-word commands used as executables

**Tags:** shell, hooks, trap

When a shell variable contains a multi-word command like `pnpm dlx @mmnto/cli`, quoting it as `"$TOTEM_CMD" lint` prevents word splitting and makes the shell look for a single executable named `pnpm dlx @mmnto/cli` (with spaces). Use unquoted `$TOTEM_CMD lint` instead so the shell correctly splits the command. This is safe when the variable content is controlled by the application, not user input. Use `[ -n "$TOTEM_CMD" ]` (quoted) only for emptiness checks, not execution.

**Source:** mcp (added at 2026-03-24T18:46:51.883Z)
