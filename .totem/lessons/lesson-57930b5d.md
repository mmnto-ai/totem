## Lesson — Store hook logs inside Git directory

**Tags:** git, logging, architecture

Storing local hook logs inside the `.git` directory ensures they are never tracked, guarantees write permissions where Git itself can write, and avoids creating untracked files for non-adopting consumers.
