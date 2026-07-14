---
'@mmnto/totem': patch
---

security(ingest): skip symlinks under ingest globs so a planted symlink can't read host-file content into the index (mmnto-ai/totem#2354).

The corpus ingest walk read each matched file with `fs.readFileSync`, which follows symlinks — so a symlink committed under an ingested glob (e.g. `.totem/lessons/x.md -> /etc/passwd`) had its TARGET content chunked, embedded, and stored in the searchable index on `totem sync` (auto-triggered by the post-merge/checkout hooks). The git-tracked-set gate did not defend: a symlink is a valid git entry (mode 120000). `resolveFiles` now `lstat`s each match and skips symlinks entirely — mirroring the existing mode-120000 exclusion in the compiled-rules path — and surfaces each skip as a loud sync-time warning (Tenet 13 sensor). The read site (`pipeline.ts`) re-checks symlink status immediately before reading to close the discovery→read TOCTOU gap, and symlink-derived paths are sanitized before appearing in log output.

Consumer-impact: a symlink previously ingested from an ingest target is no longer indexed, and each such file emits a `Skipping symlink under ingest target` warning on sync. Regular files are unaffected; no config or API change.
