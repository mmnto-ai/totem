# Totem Maintainer Policy

> This is a living document. Sections marked _[future]_ describe planned processes that activate when the contributor base grows.

## Current Maintainers

| Role             | Person           | Scope                                    |
| ---------------- | ---------------- | ---------------------------------------- |
| Lead Maintainer  | @satur8d (jmatt) | All packages, releases, design decisions |
| Security Contact | @satur8d         | Vulnerability reports, CVE coordination  |

## Issue Lifecycle

- **Triage window:** New issues triaged within **72 hours**.
- **P0 (Security/Critical):** Immediate response. Patch or mitigation within 48 hours.
- **P1 (High):** Functional breakage. Target fix in next patch release.
- **P2 (Medium):** Non-blocking bug. Scheduled in roadmap milestone.
- **P3 (Low):** Enhancement or docs. Triaged into backlog.
- **Response SLA:** P0/P1 acknowledged within 24 hours with ETA within 72 hours.

## Pull Request Process

- All PRs must pass CI: unit tests, `totem lint`, `totem review`, format check.
- Core package changes require Lead Maintainer review.
- Merge policy: squash merge after approval and green CI.
- `Closes #NNN` keyword required in PR body for auto-close.

## Security

- Report vulnerabilities privately via the Security Contact (see `SECURITY.md`).
- Coordinated disclosure. Fixes released with CVE if applicable.
- Critical security fixes are prioritized above all other work.

## Release Cadence

- **Patch releases:** As needed for bug fixes and lesson compilation.
- **Minor releases:** Every 2-4 weeks for features.
- **Major releases:** Planned with 30 days advance notice.
- Changeset handles versioning and npm publish. Do not manually bump versions.

## Contributing

- Fork, branch, PR with template, link to issue.
- Run `pnpm run format` before committing. Run `/prepush` before pushing.
- New lessons are welcome. Run `totem lesson compile` after adding lessons.

## _[Future]_ Scaling the Contributor Base

The following processes activate when Totem has 3+ regular contributors:

- **Core Maintainers:** Commit rights for core packages. 2-week oncall triage rotation.
- **Community Maintainers:** Limited merge rights for docs, rule packs, and non-core changes.
- **Onboarding:** Nomination, 2-week shadowing, 3-month probationary period.
- **Bounty Program:** Optional bounties for high-impact issues.
- **Communication:** GitHub Discussions for community. Private channel for enterprise support.

## Review

This policy is reviewed quarterly. Changes are documented in the repo.
