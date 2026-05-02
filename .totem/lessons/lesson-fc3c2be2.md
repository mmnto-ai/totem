## Lesson — Include generated artifacts in files

**Tags:** npm, dx
**Scope:** packages/pack-rust-architecture/package.json

The prepare script does not run on consumer installs; ensure generated artifacts like WASM binaries are explicitly listed in the files array to be included in the tarball.
