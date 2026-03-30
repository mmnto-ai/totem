## Lesson — Using .find() inside a loop to match commands to groups

**Tags:** performance, cli

Using .find() inside a loop to match commands to groups results in O(n^2) complexity during help generation. Pre-indexing visible commands into a Map allows for constant-time lookups as the number of CLI commands grows.
