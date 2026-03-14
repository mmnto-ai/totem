# Release Process

Totem uses Changesets for versioning and changelog generation, combined with npm OIDC trusted publishing to ensure secure releases without long-lived npm tokens.

## 1. Creating a Changeset

When you complete a feature or bug fix, you must create a changeset.

**Important:** The interactive Changeset CLI (`pnpm changeset`) often fails when operating through piped stdin (which happens frequently when AI agents run shell commands).

**Workflow:**
Write the changeset manually as a Markdown file in the `.changeset/` directory.

Example `.changeset/my-feature-name.md`:

```markdown
---
'@mmnto/cli': minor
'@mmnto/core': patch
---

Added support for JetBrains Junie auto-detection in `totem init`.
```

_(Use `patch` for bugfixes, `minor` for features, and `major` for breaking changes)._

## 2. Versioning Command

When preparing a release, **never use bare `pnpm version`**, as this resolves to pnpm's built-in versioning tool and bypasses Changesets.

Instead, always run the repository script:

```bash
pnpm run version
```

This consumes the `.changeset/` files, updates `package.json` versions across the workspace, and updates `CHANGELOG.md` files.

## 3. The "Version Packages" PR Flow

1. Push your changesets to `main`.
2. A GitHub Action automatically creates (or updates) a "Version Packages" PR.
3. Review the PR to ensure the changelog generation looks correct.
4. Merge the PR into `main`.
5. The `release.yml` workflow will automatically trigger, build the packages, and publish them to npm.

## 4. OIDC Trusted Publishing & `RELEASE_TOKEN`

We publish to npm using OIDC (OpenID Connect) trusted publishing. This means GitHub Actions requests a short-lived token directly from npm, rather than storing a permanent `NPM_TOKEN` secret.

**Why `RELEASE_TOKEN`?**
Our GitHub organization restricts the default `GITHUB_TOKEN` from creating Pull Requests. Therefore, the automation requires a Personal Access Token (PAT) named `RELEASE_TOKEN` stored in GitHub Actions secrets to create the "Version Packages" PR.

## 5. Batch Strategy

To reduce release noise, aim to batch approximately ~3 PRs per release.
Documentation updates should generally be batched and merged alongside or immediately prior to a release.
