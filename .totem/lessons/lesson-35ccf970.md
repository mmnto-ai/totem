## Lesson — Files containing active rule patterns often trigger those

**Tags:** linting, ast-grep, recursion

Files containing active rule patterns often trigger those same rules during a scan. Compiled rule assets must be excluded from validation to prevent "self-violations" where the detection logic flags its own source code.
