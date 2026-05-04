## Lesson — Fixed grouping cascades major version bumps

**Tags:** changesets, semver
**Scope:** .changeset/*.md

When using 'fixed-grouping' in Changesets, a major bump in a single package forces a major bump across the entire group. Downgrading to a minor bump is a valid tactic to prevent unnecessary version inflation across the ecosystem.
