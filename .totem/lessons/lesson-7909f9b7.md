## Lesson — Git post-checkout hooks receive a string of forty zeros

**Tags:** git, hooks, bash

Git post-checkout hooks receive a string of forty zeros as the previous SHA during an initial clone or checkout. Hook scripts must explicitly handle this null-SHA case to prevent failures in commands like git diff that require valid object references.
