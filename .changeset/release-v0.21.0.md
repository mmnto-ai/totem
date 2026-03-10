---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

### New Features

- **`totem shield --mode=structural`** — Context-blind code review that catches syntax-level bugs (asymmetric validation, copy-paste drift, brittle tests, off-by-one errors) without Totem knowledge retrieval (#270)
- **`totem compile --export`** — Cross-model lesson export via sentinel-based injection into AI assistant config files (#269)

### Improvements

- Provider conformance suite with 15 tests and nightly smoke tests (#263)
- CLA automation via `contributor-assistant/github-action` (#266)
- Dependabot configured for security-only npm scanning and GitHub Actions version pinning (#272)
- GitHub Actions updated: `actions/checkout` v4→v6, `actions/setup-node` v4→v6 (#273, #274)
- Project docs and lessons synced via `totem wrap` (#275)
