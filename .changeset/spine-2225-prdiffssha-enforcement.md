---
'@mmnto/totem': patch
---

fix(spine): enforce prDiffsSha at the certifying run + freeze (#709 fold-2 enforcement)

The #709 producer stamps `controls.integrity.prDiffsSha` (a sha256 over the exact on-disk `pr-diffs.json` bytes), but nothing re-derived or asserted it — so the certifying run's scoring source was **stamped-but-runtime-unauthoritative**: a silent mutation of any row (advisory-window or control) would corrupt the disposition-derived answer key while `fixtureSha` (control-dirs-only) stayed green. This closes that seam (codex-panel-caught, affirmed + sharpened by strategy-claude: digest the FULL pr-diffs.json, verify at freeze AND run).

- **Certifying run** (`buildReplayCorpusProvider`): re-derive the digest over the on-disk `pr-diffs.json` bytes and **hard-error** on absent/mismatch — beside the `llmReplaySha` L2 gate.
- **Freeze**: a **warn-only** pre-merge check, mirroring the `fixtureSha` freeze behavior (the run is the authoritative gate).
