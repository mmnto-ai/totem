## Lesson — Optimization paths that process file deltas must still

**Tags:** git, cli, logic

Optimization paths that process file deltas must still apply the project's ignore patterns to avoid analyzing sensitive or irrelevant files like lockfiles. Bypassing these filters during incremental reviews can lead to false positives or processing of vendored code.
