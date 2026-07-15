# Proof kit

One real mistake, blocked forever — and every claim about it recomputes from
this directory.

The fixture under [`fixture/`](fixture/) is a tiny repository that lived
through one incident: a legacy retry helper swallowed three weeks of send
failures behind an empty catch block
([the incident record](fixture/docs/incident-2026-06-silent-failures.md)).
The loop this kit proves is the product's core loop:

1. **The mistake happened** — the repro is quarantined at
   [`fixture/src/legacy/retry-2026-06.js`](fixture/src/legacy/retry-2026-06.js).
   It stays in the tree on purpose: it is the compiled rule's positive
   control (Stage 4 verifies the pattern fires on the real historical shape).
2. **The lesson was banked** —
   [`fixture/.totem/lessons/lesson-empty-catch.md`](fixture/.totem/lessons/lesson-empty-catch.md),
   plain markdown.
3. **The rule was compiled and human-promoted** — the committed
   [`fixture/.totem/compiled-rules.json`](fixture/.totem/compiled-rules.json)
   carries the ast-grep rule with the lesson's content hash (`lessonHash`) —
   the provenance chain from incident to enforcement is mechanical. Rules
   ship zero-trust advisory (ADR-089); promotion to blocking is a recorded
   human sign-off, same register as everything else here: a human merges
   every change.
4. **The recurrence is blocked** — [`mistake.diff`](mistake.diff) reintroduces
   the exact mistake (it exists in this repo only as a diff artifact, never as
   applied source). [`run.mjs`](run.mjs) applies it in a temp checkout and
   proves `totem lint` exits non-zero with the fixture rule firing — then
   proves a clean change on the same file passes.

## Run it

```bash
pnpm install && pnpm build
node examples/proof-kit/run.mjs        # prove the loop, regenerate receipt.json
node examples/proof-kit/run.mjs --ci   # what CI runs on every pull request
```

The proving run makes **zero LLM calls** — every provider API key is stripped
from the environment before lint runs, so anything trying to call a model
would fail loudly. [`receipt.json`](receipt.json) records the outcome and the
measured wall time together with the conditions that produced it (rule count,
diff size, platform, node, CLI version). The `timingBoundMs` assertion is the
fixture's own receipted envelope — a regression tripwire for a one-rule
corpus and a ten-line diff — not a general speed claim: lint wall time scales
with the size of your diff and your rule corpus, so numbers here always
travel with their parameters. Re-proven by the
[Proof Kit workflow](../../.github/workflows/proof-kit.yml) on every PR.

## The compile half (local, recorded — never CI)

[`compile-fixture.mjs`](compile-fixture.mjs) reruns the real
`totem lesson compile` pipeline against the fixture's own lesson corpus in a
temp directory and re-commits the produced artifacts. It needs a provider API
key and refuses to run in CI — CI stays deterministic and asserts the
committed rule instead.

**Freeze disclosure:** the host repository's own lesson corpus sits under a
standing rule-compilation freeze (since 2026-05-17 — see the
[maturity page](../../docs/wiki/maturity.md) for the live receipt). This kit's
compile step runs only against the fixture's corpus under a recorded,
cohort-adjudicated scope ruling; the host corpus is never read or written.

## The recording

[`record.sh`](record.sh) captures the demo as an asciinema cast by running
the same two scripts CI and this README describe — the recording is an output
of the kit, not a staged demo.
