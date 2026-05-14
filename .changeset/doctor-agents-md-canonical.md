---
'@mmnto/cli': minor
---

feat(doctor): add `agents-md-canonical` diagnostic per Proposal 272 § 6.7

Verifies that `CLAUDE.md` follows the ADR-038 redirect-shape constraint:

- Gates on whether the cwd is a project root (`package.json` OR `.git` present).
- Passes if there's no `CLAUDE.md` (nothing to enforce).
- Passes if `CLAUDE.md` is ≤ 600 bytes.
- Fails if `CLAUDE.md` claims to be a redirect (matches the canonical-phrase + `AGENTS.md` link pattern) but `AGENTS.md` does not actually exist.
- Fails if `CLAUDE.md` is > 600 bytes AND does not match the redirect pattern.
- Passes for a "verbose redirect" (> 600 bytes but matches the pattern AND `AGENTS.md` exists) — covers downstream consumers who pad the redirect with vendor-specific addendums.

Surface translation: Proposal 272 § 6.7 names this as a `totem lint` rule, but `totem lint` is diff-based content scanning. The predicate here is a repo-shape check, which fits the existing `check*` function registry in `doctor.ts`. Routing confirmed by strategy-Claude.

Closes #1905. Follow-on `doctor --strict` + pre-push wiring tracked in #1906.
