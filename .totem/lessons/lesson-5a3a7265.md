## Lesson — Centralizing temporary directory cleanup into a helper

**Tags:** testing, fs, windows

Centralizing temporary directory cleanup into a helper with retry logic prevents Windows-specific file system flakes caused by race conditions or locked files during teardown.
