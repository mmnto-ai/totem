# Totem COSS Covenant

> **The simple rule:** Single-repo local use is free. Multi-repo centralized governance is paid.

## Purpose

Totem is an open-core project. The enforcement engine that blocks bad pushes on your machine will always be free, open-source, and offline. The coordination layer that governs fleets of repos and agents is the commercial product.

This covenant defines exactly where that line is drawn. It will not move.

## License

The Totem core CLI, compiler, MCP server, and enforcement engine are released under **Apache 2.0**. Enterprise additions (federation, hosted services, centralized telemetry) are delivered under a separate commercial license.

## What Is Free

Everything a single team needs to enforce rules locally:

- **Enforcement:** `totem lint` with compiled rules, git hooks, SARIF output. Zero LLM, zero network, zero API keys.
- **Learning:** `totem extract`, `totem compile`, `totem review-learn`. Full lesson-to-rule pipeline.
- **AI Integration:** MCP server for agent context queries, `totem shield` for LLM-based review, `totem spec` for planning.
- **Rule Packs:** Community baseline packs (TypeScript, Python, Rust, Go) and ecosystem detection.
- **Self-Healing:** Trap Ledger, `totem doctor --pr`, automatic rule downgrading.
- **Source Code:** Full source for all core packages on GitHub.

## What Is Paid

Operational features for organizations governing multiple repos and agent fleets:

- Cross-repo rule federation with RBAC and manifest attestation.
- Hosted compile service and centralized manifest signing.
- Centralized Trap Ledger ingestion, immutable audit storage, and compliance dashboards.
- SLA-backed support, security reviews, and on-prem deployment assistance.
- Enterprise connectors and managed infrastructure.

## Privacy

- Core enforcement runs **locally**. No data leaves your machine unless you opt in.
- Enterprise telemetry is opt-in. Uploads are encrypted and signed. Customers control retention and export.
- DLP masking is applied at every LLM boundary before any external call.

## Trust

- Compiled rules are deterministic. You can verify them locally against the source lessons.
- Compile manifests provide cryptographic provenance: input hash, output hash, model, timestamp.
- Security disclosures follow coordinated disclosure via `SECURITY.md`.

## Contributions

Community contributions to core packages and baseline rule packs are welcome under Apache 2.0. Enterprise rule packs requiring provenance guarantees or support SLAs may be distributed under commercial terms.

## Contact

- **Repository:** [github.com/mmnto-ai/totem](https://github.com/mmnto-ai/totem)
- **Commercial Inquiries:** jmatt@mmnto.ai
- **Effective Date:** 2026-03-27
- **Review Cadence:** Quarterly. Changes documented in the repo.
