## Lesson — CLI tools must check for an existing .git directory

**Tags:** cli, git, toolchain

CLI tools must check for an existing .git directory before running initialization commands. Blindly executing git init can corrupt existing repository structures or submodules already present in the target directory.
