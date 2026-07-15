## Lesson — A processed mark is collectable only after a declared,

**Tags:** ecl, gc, compaction, completeness-proof, genuine-domain

**Applies-to:** mutator

A processed mark is collectable only after a declared, non-empty cohort roster is fully scanned and every relevant peer cursor/horizon proves the mark inert; truncation, warnings, collisions, or missing roster must close the gate rather than guess. (Sweep TOTEM-SWEEP-002; anchor: #2309 @ cad2f30e, roster correction #2315.)

**Source:** mcp (added at 2026-07-12T03:08:06.199Z)
