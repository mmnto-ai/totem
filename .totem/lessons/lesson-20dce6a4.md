## Lesson — The --force flag should only bypass the tool's own

**Tags:** cli, git-hooks, safety

The --force flag should only bypass the tool's own ownership markers, not external detection like Husky or Lefthook. This prevents accidental interference with other hook managers while allowing recovery from internal state mismatches.
