# Prop 296 §14 — network-read-only posture-probe detector family

**Contract source:** Prop 296 §14 amendment (mmnto-ai/totem-strategy#962), registering the three
parity-manifest posture rows filed under mmnto-ai/totem-strategy#482:

- `repo-merge-posture` — squash-only merges + a BLANK squash body + a PR_TITLE squash title.
- `repo-required-checks-posture` — the active-ruleset required-checks union == the canonical list.
- `repo-branch-protection-posture` — the direct-push vector stays closed (classic + rulesets).

These sense **externally-hosted governed state** — GitHub repo settings / rulesets / branch
protection — that no repo file records. §14 carved a named `network-read-only` sub-class out of
§12.5's never-network default: authenticated **read-only GETs, never a mutation** (Tenet 13).

## The CLI-edge-fetch vs core-verdict split (and WHY)

`packages/core/src/parity-detect.ts` holds a module-wide **NEVER-networks + synchronous-pure**
invariant (header lines 27–35). The posture rows need a network read, so the work splits:

- **CLI edge owns the network** — `packages/cli/src/commands/doctor-parity-fetch.ts`. An async fetch
  step runs BEFORE detector dispatch and resolves per-repo, per-surface **snapshots**. Transport is
  `gh api <path>` spawned via `safeExec` (arg arrays, bounded timeout, no `shell: true`), behind an
  **injectable `GhFetch` seam** so tests feed canned JSON and never spawn `gh`.
- **Core owns the verdict** — `detectNetworkPostureContract(contract, ctx)` in `parity-detect.ts` is
  a new sync-pure detector taking the PRE-FETCHED snapshots. The fetched JSON is untrusted boundary
  input, Zod-narrowed max-tolerance (mis-shaped → auth-class/`unknown` for that surface, never a
  throw). It returns an ARRAY of per-repo verdict lines (`LockContentLine[]` pattern).

The module never gains a network call; the fetch never gains a verdict.

## Verdict mapping (surface outcome → verdict)

The detector emits the existing `ParityContractVerdict` vocabulary — `pass`/`warn`/`skip`/`unknown`
only (never `fail`; the CLI edge owns `--strict` promotion). `warn` = real drift (sensor, not gate).

| Surface outcome                               | Verdict   | Rationale                                                              |
| --------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `ok` + posture holds                          | `pass`    | verified conformant                                                    |
| `ok` + posture mismatch                       | `warn`    | verified drift (Tenet 13 — advisory)                                   |
| `ok` + 200 WITHOUT the posture fields         | `unknown` | under-privileged token; auth-class, never posture-false (§14 clause 2) |
| `no-transport` (gh absent / offline)          | `skip`    | honest-absent stub (§14 clause 4); no retries                          |
| `auth` (no / under-privileged token, 401/403) | `unknown` | cannot-verify, never a drift verdict (§14 clause 2)                    |
| `not-found` (404 on a governed surface)       | `unknown` | indistinguishable from under-privilege; cannot-verify (§14 clause 2)   |
| `error` (5xx / timeout / DNS / unparseable)   | `unknown` | transient / unparseable                                                |
| row-2 declaration file absent                 | `skip`    | "declaration not yet committed" — honest-absent, not an error          |
| row-2 declaration unparseable                 | `unknown` | canonical underivable (the Stale-Doctor-Paradox)                       |

Per §14 clause 3 the detector emits **per-repo verdict LINES**, never one blended verdict. Row-3 is
dual-surface, so it emits **two lines per repo** (classic + rulesets) — each surface renders its own
cannot-verify honestly (one can `pass` while the other is `unknown`).

## The roster rule

- The **current repo is always probed** — its `owner/repo` slug is derived from the LOCAL git remote
  (no network), mirroring `deriveCohortRepoId`'s remote seam.
- **Cross-repo is opt-in** via `orient.parityProbeRepos` (additive, optional `owner/repo[]`). §14
  clause 3: CI/consumer default is current-repo-only — cross-repo reads need a cross-repo-privileged
  seat token; a repo-scoped CI token that cannot see siblings degrades each extra repo to a per-repo
  cannot-verify line, never a manifest-wide outage.
- Each row's `consumers:` scope is respected **per-repo**: a row scoped `consumers: [totem]` senses
  only roster repos whose derived id is `totem`; the fetch step fetches, per repo, only the surfaces
  the in-scope rows need.

**Row-2 canonical** comes from the totem-side declaration `.totem/rulesets/main.json` (schema-version
1; `required_status_checks.contexts` + `.strict_required_status_checks_policy`). The union of
`required_status_checks` across all default-branch-targeting rulesets is set-compared BOTH directions
against it, AND every ruleset **contributing** a canonical check must itself be enforcement=active,
target `~DEFAULT_BRANCH`, `bypass_actors=[]`, and hold the pinned strict policy — the union must not
hide a bypassable contributing ruleset.

## Non-goals (declared)

- **No caching** — every run reads from scratch (the pure-detector invariant).
- **No retries** — a transport failure degrades once, honestly.
- **No cross-repo fan without config** — current-repo-only unless `parityProbeRepos` opts in.
- **No gate / exit-code coupling** — the detector is a SENSOR: `warn` for drift, never `fail`. The
  `--strict` blocking promotion stays a CLI-edge concern (unchanged).
- **No write, ever** — read-only GETs only (§14 clause 1, Tenet 13).

## Ambiguities resolved

- **"UNION across ALL active rulesets" vs the contributing-ruleset-bypass test.** Taken literally,
  excluding evaluate-mode rulesets from the union would turn a bypassable contributing ruleset into a
  blunt "missing check". Resolved: the union spans all default-branch-targeting rulesets that carry a
  `required_status_checks` rule (any enforcement mode) so the set-compare stays precise, and the
  per-contributing-ruleset enforcement gate is what flags the evaluate-mode / bypassable / strict
  case with a precise reason (matches the greptile-P1 round finding on strategy#962).
- **404 on a governed surface.** Indistinguishable from under-privilege on branch protection /
  rulesets, so mapped to `unknown` (cannot-verify), never treated as "protection absent = drift".
