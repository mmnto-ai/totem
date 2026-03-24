# Lesson

**Context:** The project requires manual intervention when dealing with changesets.
**Symptom:** Developers sometimes rely on interactive CLI tools that fail with piped stdin, causing issues during the release process. `pnpm version` is also misused, bypassing the Changesets workflow.
**Fix:**
### Maintainer Release Process
When completing a feature or bug fix, create a changeset manually in the `.changeset/` directory as a Markdown file (e.g., `patch`, `minor`, `major`) rather than using interactive CLIs, as they often fail with piped stdin. 

When preparing a release, NEVER use bare `pnpm version`. Always run the repository script `pnpm run version`, which consumes the changesets and updates `CHANGELOG.md` files.

The "Version Packages" PR flow uses OIDC trusted publishing. GitHub Actions requests a short-lived token from npm. A `RELEASE_TOKEN` PAT is used to create the PR since our org restricts the default `GITHUB_TOKEN`.

Post-Release Checklist:
1. Extract lessons: `totem extract <pr-numbers> --yes`
2. Sync wiki: Copy `docs/wiki/*.md` to the GitHub Wiki repo and push.
3. Verify roadmap matches the Wiki.
4. Update memory by bumping the version number.