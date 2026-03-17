## Lesson — Filesystem lockfile implementations must handle corrupted

**Tags:** manual

Filesystem lockfile implementations must handle corrupted lock files (empty, invalid JSON) separately from missing files. A corrupted file causes fs.writeFile with 'wx' flag to throw EEXIST, but readLock returns null — creating an unrecoverable retry loop. Check file age (mtime) before deleting to avoid TOCTOU races with concurrent writers. Tags: concurrency, filesystem, trap
