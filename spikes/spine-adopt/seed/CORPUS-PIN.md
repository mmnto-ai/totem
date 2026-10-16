# The census corpus — the pin

Charter: `spikes/spine-adopt/DECISION.md` ("SCOPED to this V1 corpus and ruleset") and
ADR-103 § "The inexpressible-pattern routing rule" (mmnto-ai/totem-strategy, "49 of the 226 regex
patterns in the compilation-target census"). Sibling pin: `seed/PIN.md` (the frozen seed-20 records).

**Pin:** `694acffbf8f91c6b06c5bdba3d3519707f2448d0` — the spike's own last apparatus commit
(2026-09-01). The four shipped corpora at that commit are the corpus every census number in this
spike was taken against: 500 rules across the four files, 226 carrying a non-empty regex `pattern`,
the 226 ADR-103 binds to. Their blob oids at the pin, verified with `git rev-parse <pin>:<path>`:

| corpus                 | path                                                  | blob (12)      |
| ---------------------- | ----------------------------------------------------- | -------------- |
| root                   | `.totem/compiled-rules.json`                          | `589f3f166623` |
| pack-agent-security    | `packages/pack-agent-security/compiled-rules.json`    | `a18e58d848fd` |
| pack-agent-workflow    | `packages/pack-agent-workflow/compiled-rules.json`    | `a9e326ddbb63` |
| pack-rust-architecture | `packages/pack-rust-architecture/compiled-rules.json` | `18a294fa8bda` |

The same four blobs sit at every `main` commit from the pin through `934296aa^` (2026-10-13). At
`934296aa` ("S6 step 7 — the serving file regenerated from the floor file of record") the root
corpus moved to 513 rules and 220 patterns, so the live tree reads 528 and 229 and the census's
intake assertions failed on every run from the 2.16.1 cut onward (fifteen runs; the last green
run 2026-10-12 on a `main` push).

**Why a pin, not a re-count.** The census is a record of the corpus the spike was scoped to, and
its 226 is cited by ADR-103 as the compilation-target census; re-pinning the numbers to the live
tree would silently change what the ADR describes, and every later corpus change would break the
harness again. The harness therefore reads the four corpora AT THE PIN (`git show <pin>:<path>`,
the `readCorpus` helper in `src/lib/spike-env.mts`) and keeps each repo-relative path as the label
the committed artifacts record, so the artifacts' `corpora[].file` fields are unchanged. A spike
edit that deliberately moves the census to a newer corpus moves this pin and the numbers in
`src/census.mts` together, in one commit, with the ADR citation re-read.

**Why the workflow stopped running on tags.** `spine-spike-linux.yml` is `on: push` with a
`paths` filter on this directory; GitHub does not evaluate path filters for tag pushes, so every
release cut's tag pushes (the four package tags and the floating `v0`) ran the harness and failed
it on the stale census. The push trigger now also names `branches: ['**']`, and a workflow with
only branches named does not run for tag pushes; the paths filter governs branch pushes as before.

Verification, from a checkout of the pin's repository:

```bash
git cat-file -e 694acffbf8f91c6b06c5bdba3d3519707f2448d0^{commit}
git rev-parse 694acffbf8f91c6b06c5bdba3d3519707f2448d0:.totem/compiled-rules.json   # 589f3f16…
cd spikes/spine-adopt && npm run census && npm run verify-records
```
