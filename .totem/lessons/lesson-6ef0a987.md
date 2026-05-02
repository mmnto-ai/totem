## Lesson — Publishing private cohort members

**Tags:** npm, changesets, ci
**Scope:** packages/pack-rust-architecture/package.json

Flipping a package to public within a versioned cohort triggers a publish if the version is missing from the registry, as changeset publish handles workspace dependency resolution without requiring a new changeset.
