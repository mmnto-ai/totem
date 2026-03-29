## Lesson — Hashing all lesson files to find a rule's source

**Tags:** performance, cli, architecture

Hashing all lesson files to find a rule's source during CLI operations is expensive and non-scalable. Storing the source file path directly within the compiled rule object avoids these lookups.
