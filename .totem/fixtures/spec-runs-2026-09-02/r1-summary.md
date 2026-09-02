# R1 re-retrieval measurements

Generated 2026-09-02T21:09:50.935Z · index D:\Dev\totem\.lancedb · table totem_chunks (5903 rows)

## Census

- artifacts scanned: 158
- `caller === 'spec'`: 55
- anchorKind `issue`: 30
- anchorKind `mixed(issue+topic)`: 1
- anchorKind `topic`: 24
- queries re-run this pass: 55
- index chunk types: {"code":3649,"spec":373,"lesson":1881} (total 5903)
- expansion (`expandSpecQuery`) applied: 11/55

## Stored vector norms

- n=2000 (of 5903 rows) · min=0.999999 · p5=1.000000 · median=1.000000 · mean=1.000000 · p95=1.000000 · max=1.000001
- unit-norm (|1 − norm| < 1e-3 for all): true

## Query vector norms

- 1.000000 · dims=768 · 692ch · `tooling: bare 'bash' resolves to WSL on Windows — export ONE…`
- 1.000000 · dims=768 · 621ch · `status: 'Rules: 0 compiled' when manifest absent contradicts…`
- 1.000000 · dims=768 · 621ch · `mail CLI: add a seat-specific --self/--to selector + documen…`
- 1.000000 · dims=768 · 26ch · `xyzzy plugh qwertyuiop zzz…`
- 1.000000 · dims=768 · 32ch · `blorptak fnord wibblewobble quux…`
- all unit-norm: true

## Distance metric

- determined: `l2sq` (3/3 trials, |diff| < 1e-5)
  - self-hit `packages/mcp/src/utils.ts` isSelf=true _distance=0.00000000; B sdk=0.30962545 l2=0.55643997 l2sq=0.30962544 1−cos=0.15481278 cos=0.84518722; cosine-metric B=0.15481287
  - self-hit `.gemini/skills/totem.md` isSelf=true _distance=0.00000000; B sdk=0.27313575 l2=0.52262393 l2sq=0.27313577 1−cos=0.13656791 cos=0.86343209; cosine-metric B=0.13656795
  - self-hit `.totem/lessons/testing-conventions.md` isSelf=true _distance=0.00000000; B sdk=0.26284960 l2=0.51268858 l2sq=0.26284958 1−cos=0.13142480 cos=0.86857520; cosine-metric B=0.13142478
- SDK 0.26.2; query.d.ts VectorQuery.distanceType: "Set the distance metric to use ... By default \"l2\" is used."
- range for unit vectors: _distance ∈ [0, 4] ⇒ 1/(1+_distance) ∈ [1/5, 1] = [0.2, 1]

## Overlap vs the historical grounding bundle

| group | n | mean J(path) | median J(path) | mean J(hash) | median J(hash) | J(path)=0 | J(hash)=0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| all | 55 | 0.3780 | 0.3333 | 0.1812 | 0.0667 | 0 | 15 |
| issue | 30 | 0.2984 | 0.2614 | 0.0745 | 0.0667 | 0 | 13 |
| topic | 24 | 0.4830 | 0.5000 | 0.3162 | 0.2308 | 0 | 2 |
| mixed | 1 | 0.2500 | 0.2500 | 0.1429 | 0.1429 | 0 | 0 |

- historical bundle sizes: {"n":55,"min":8,"p5":8,"median":8,"mean":8,"p95":8,"max":8}
- re-retrieved bundle sizes: {"n":55,"min":8,"p5":8,"median":8,"mean":8,"p95":8,"max":8}

## Vector-leg relevance

| group | n | min best | median best | max best | best < 0.333 | best < 0.25 |
| --- | --- | --- | --- | --- | --- | --- |
| all | 55 | 0.5641 | 0.6897 | 0.7678 | 0 | 0 |
| issue | 30 | 0.6383 | 0.7035 | 0.7678 | 0 | 0 |
| topic | 24 | 0.5641 | 0.6361 | 0.7358 | 0 | 0 |
| mixed | 1 | 0.7470 | 0.7470 | 0.7470 | 0 | 0 |

- `spec` leg: bestRelevance min=0.5277 median=0.6358 max=0.7541; worstRelevance min=0.5022 max=0.6250; queries with best < 0.333 = 0, < 0.25 = 0
- `session_log` leg: bestRelevance min=n/a median=n/a max=n/a; worstRelevance min=n/a max=n/a; queries with best < 0.333 = 0, < 0.25 = 0
- `code` leg: bestRelevance min=0.5641 median=0.6897 max=0.7678; worstRelevance min=0.5406 max=0.6998; queries with best < 0.333 = 0, < 0.25 = 0
- all vector hits: 3795; below 0.333 = 0; below 0.25 = 0
- all raw FTS hits: 2270
- delivered production hits: 440; carrying `relevance` (vector leg present): 410; FTS-only (no `relevance`): 30
- delivered-hit relevance: min=0.5100 median=0.6189 max=0.7541; below 0.333 = 0; below 0.25 = 0
- bundle items: 440; carrying `relevance`: 410
- delivered by partition: {"specs":275,"sessions":0,"code":165,"lessons":0} over 55 queries (caps: specs 5, sessions 5, code 3, lessons 10)
- queries delivering 0 sessions: 55; 0 lessons: 55; 0 code: 0

## Cost

- wall: 37.7s for 55 queries
- embed calls: production 165, harness 60, total 225 (outer retries 0, failures 0)
- chars embedded: 101072
- production call ms: mean 320.0 · median 310.0 · p95 407.7 · max 564.0
- raw-legs ms: mean 334.0 · median 331.0 · p95 406.3 · max 482.0
- machine: Intel(R) Core(TM) Ultra 7 265K (20 threads), 63.38 GiB, win32 10.0.26200, node v24.16.0
