## Lesson — Issue numbers are only unique within a single repository;

**Tags:** github, multi-repo, ux

Issue numbers are only unique within a single repository; when aggregating multiple sources, use qualified syntax like owner/repo#number. This prevents CLI commands from accidentally targeting the wrong issue when numbers collide across configured projects.
