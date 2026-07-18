---
'@mmnto/totem': patch
---

Add a `generic` built-in chunk strategy — the chunker's fourth-language-layer Stage 1 (Proposal 256 Option A, mmnto-ai/totem#2387). A language-agnostic, fixed-size line-window chunker (with overlap) that gives retrieval-index coverage to source with no dedicated chunker yet (Rust, GDScript), closing the non-TypeScript index lockout.

Selection is explicit-opt-in only (mmnto-ai/totem#2308): consumers reach it by naming `strategy: 'generic'` on a `totem.config.ts` target. It is a normal registered built-in rather than an implicit catch-all — `createChunker` still fail-louds on an unknown/misspelled strategy per Tenet 4. Precision-poor by design; superseded per-language by the Stage 2 AST chunkers as they ship.
