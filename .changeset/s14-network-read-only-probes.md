---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

Add the Prop 296 §14 `network-read-only` parity posture-probe family: the `totem doctor --parity`
sensor now senses the three governed-state posture rows (`repo-merge-posture`,
`repo-required-checks-posture`, `repo-branch-protection-posture`) registered on the manifest
(mmnto-ai/totem-strategy#962 amending Prop 296, rows filed mmnto-ai/totem-strategy#482).

- **CLI edge owns the network** — a new `doctor-parity-fetch.ts` resolves per-repo, per-surface
  snapshots via `gh api` read-only GETs behind an injectable transport seam, BEFORE detector
  dispatch. Core's `parity-detect.ts` keeps its never-network + synchronous-pure invariant.
- **Core owns the verdict** — a new sync-pure `detectNetworkPostureContract` Zod-narrows the
  untrusted fetched JSON and emits per-repo verdict LINES (`warn` for real drift, `skip` for
  offline / honest-absent, `unknown` for auth-class / transient — never a drift verdict on an
  auth/transport failure, never a manifest-wide outage). It never gates; `--strict` promotion stays
  a CLI-edge concern.
- Auth is the hard edge, rendered honestly: no token / under-privileged token / a 200 without the
  posture fields / a 404 on a governed surface / a repo-scoped CI token that cannot see siblings all
  degrade to a per-surface cannot-verify line. Offline (gh absent) renders the honest-absent stub.
- The current repo (derived from the local git remote) is always probed; cross-repo reads are opt-in
  via the additive `orient.parityProbeRepos` config. The manifest gains an optional forward-compat
  `probe-class` field (max-tolerance boundary narrowing, never a dark manifest).
