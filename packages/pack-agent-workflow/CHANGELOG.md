# @mmnto/pack-agent-workflow

## 2.9.1

### Patch Changes

- e4f35b4: ci(tests): `hookTimeout` rides the same platform floor as `testTimeout` in every workspace vitest config (30 s on win32, 15 s elsewhere; it sat at vitest's separate 10 s default), and the `scripts/sync-labels.ps1` dry-run suite carries a 60 s per-row budget for its cold `pwsh` spawn on a loaded runner (mmnto-ai/totem#2896: four CI timeouts in files the failing PRs did not touch — three timeouts across two distinct rows at the 15 s test limit on macOS, one `beforeEach` at the 10 s hook limit on Windows). Test configuration only; no runtime behavior changes.

## 2.9.0

## 2.8.0

## 2.7.0

## 2.6.0

## 2.5.0

## 2.4.0

## 2.3.0

## 2.2.1

## 2.2.0

## 2.1.0

## 2.0.0

## 1.124.0

## 1.123.0

## 1.122.0

## 1.121.0

## 1.120.0

## 1.119.0

## 1.118.1

## 1.118.0

## 1.117.0

## 1.116.0

## 1.115.0

## 1.114.0

## 1.113.1

## 1.113.0

## 1.112.0

## 1.111.1

## 1.111.0

## 1.110.0

## 1.109.0

## 1.108.0

## 1.107.1

## 1.107.0

## 1.106.0
