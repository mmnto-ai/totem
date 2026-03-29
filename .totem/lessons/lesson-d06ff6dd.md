## Lesson — Using 'git merge-base --is-ancestor' allows a tool

**Tags:** git, performance

Using 'git merge-base --is-ancestor' allows a tool to distinguish between simple new commits and complex rebases. This prevents unnecessary invalidation of status flags when the current HEAD is a direct descendant of the previously verified commit.
