## Lesson — Using job-level 'if' conditions for required status checks

**Tags:** github-actions, branch-protection

Using job-level 'if' conditions for required status checks can cause branch protection to hang on 'pending' when a job is skipped; use internal step-level bypasses instead.
