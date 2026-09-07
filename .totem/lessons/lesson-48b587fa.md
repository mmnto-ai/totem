## Lesson — Shadow executables for dry runs

**Tags:** powershell, testing, dry-run
**Scope:** scripts/**/*.ps1

In PowerShell scripts, you can implement a safe dry-run (`-WhatIf`) mode by defining a script-scoped function that shadows an external executable (like `gh`). This intercepts and prints commands instead of executing them, without needing to modify the literal command invocations.
