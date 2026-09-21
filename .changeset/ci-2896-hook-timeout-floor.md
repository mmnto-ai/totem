---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

ci(tests): `hookTimeout` rides the same platform floor as `testTimeout` in every workspace vitest config (30 s on win32, 15 s elsewhere; it sat at vitest's separate 10 s default), and the `scripts/sync-labels.ps1` dry-run suite carries a 60 s per-row budget for its cold `pwsh` spawn on a loaded runner (mmnto-ai/totem#2896: four CI timeouts in files the failing PRs did not touch — three timeouts across two distinct rows at the 15 s test limit on macOS, one `beforeEach` at the 10 s hook limit on Windows). Test configuration only; no runtime behavior changes.
