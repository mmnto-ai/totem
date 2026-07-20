---
'@mmnto/cli': minor
---

fix(review): deterministic skip paths no longer stamp the push-gate cache (#2466)

`totem review` has three deterministic skip paths that drop the entire diff without examining it — all-non-code, no-code-remaining-after-filtering, and all-generated-artifacts. Each logged an informational "Deterministic fast-path" line and then called `writeReviewedContentHash(...)` before returning, so a run that reviewed nothing minted `.totem/cache/.reviewed-content-hash` — the marker PreToolUse hooks read as review authorization. A non-review both exited 0 and left behind a stamp claiming the tree was reviewed.

The three paths are no longer equivalent in danger, which is why all three are fixed rather than only the reported one. `content-hash.sh` hashes only tracked files matching the review extensions (default `.ts`/`.tsx`/`.js`/`.jsx`), so for all-non-code and filtered-empty the hash is unchanged and the stamp was a no-op — the defect there is the dishonest clean-pass surface. The all-generated path is different: `.gitattributes linguist-generated` can mark a tracked `.ts` file as generated, so that path can drop a hashed source file, write a fresh stamp over the new hash, and authorize code no reviewer saw.

All three now emit a `NON-REVIEW:` warning stating that nothing was examined and that the reviewed-content-hash was not stamped, and none of them stamp. The notice is single-sourced so the three sites cannot drift into describing the same guarantee differently, and its voice matches the existing worktree-drift notices — the other surface that declines to stamp. This mirrors the reasoning already applied to `--estimate` (an estimate is a forecast, not a passing review) and the standing repo rule against stamping the cache on non-reviews.

Prose-only pushes are unaffected: the gate compares a hash over code files that a prose change does not touch, so it remains satisfied by the last genuine review.

Bumped minor rather than patch on the slice-A precedent — push-gate authorization is user-visible behavior, and a consumer marking tracked sources as generated will now correctly be asked for a real review where one was previously minted for them.

Sibling of #2452 slice A: that gate keys on lanes inside a verdict artifact, which these paths return before ever constructing, so it could not reach them. The remaining question — whether a total skip should also carry a distinct exit state rather than exiting 0 — is deliberately left open.
