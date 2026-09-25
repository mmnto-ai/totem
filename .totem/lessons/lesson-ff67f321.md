## Lesson — Keep the repository form canonical for gh: fold github.com's www. alias and lower-case the host

**Tags:** git, github, normalization
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Lower-case an issue URL's host and fold github.com's `www.` alias to `github.com` so the repository reaches `gh --repo` in its canonical `owner/repo` form; strip `www.` from no other host (a GitHub Enterprise host keeps it as its own). The rationale is canonical form, not a failure prevented: gh 2.99 resolves `www.github.com/owner/repo` by itself, and the round's claim that it could not was measured false before the wording was kept (mmnto-ai/totem#2965, greptile 4107416746 and leg 2).
