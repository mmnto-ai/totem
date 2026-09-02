# R1 relevance-labelling rubric (mmnto-ai/totem-strategy#1193)

Applied by Opus labelling legs to `r1-candidates-blind.ndjson`; the seat spot-checks a sample. Labels are per (query, chunk) pair and are made WITHOUT knowing which retrieval arm delivered the chunk (the blind file carries no arm provenance and the candidates are shuffled per query).

## The question, per pair

"Would an engineer writing the pre-work spec for THIS anchor (issue or topic) use THIS chunk?" — i.e. does the chunk carry information that the draft's Problem Statement, Files to Examine, Technical Approach, Edge Cases or Implementation Tasks would legitimately draw on.

## Labels

- `2` RELEVANT — the chunk is about the same subsystem, file, contract, command, or trap the anchor concerns, and a spec author would cite it or read the file it points to (e.g. the function the issue asks to change; a lesson or ADR section stating an invariant the change must respect; a sibling implementation the change should mirror).
- `1` MARGINAL — same general area (same package or same family of commands) but the chunk does not inform this specific change; an author might skim it and move on.
- `0` NOT RELEVANT — a different subsystem, a generic/boilerplate chunk (roadmap tables, changelog rows, unrelated wiki sections), or a chunk whose only link to the anchor is a shared common word.

Precision counts `2` only. `1` is recorded so the boundary is auditable.

## Rules

- Judge the CHUNK TEXT as given (truncated to 2000 chars; the `filePath` and `label` are part of the evidence). Do not open the file in the repo — the retrieval delivered the chunk, not the file.
- Judge against the ANCHOR as given (issue title + masked body, or the topic text). Do not use knowledge of what was eventually built.
- One label per pair; no ties. Give a ≤120-char reason for every `2` and for every pair you found hard.
- Do not infer arms, do not rank, do not compare candidates with each other beyond the anchor — each pair is judged on its own.
