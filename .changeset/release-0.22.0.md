---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

### 0.22.0 — AST Gating, OpenAI Orchestrator, Security Hardening

**New Features**
- **Tree-sitter AST gating** for deterministic shield — reduces false positives by classifying diff additions as code vs. non-code (#287)
- **Generic OpenAI-compatible orchestrator** — supports OpenAI API, Ollama, LM Studio, and any OpenAI-compatible local server via BYOSD pattern (#285, #293)
- **`totem handoff --lite`** — zero-LLM session snapshots with ANSI-sanitized git output (#281, #288)
- **CI drift gate** with adversarial evaluation harness (#280)
- **Concise lesson headings** — shorter, more searchable headings from extract (#271, #278)

**Security Hardening**
- Extract prompt injection hardening with explicit SECURITY NOTICE for untrusted PR fields (#279, #289, #295)
- Path containment checks in drift detection to prevent directory traversal (#284)
- ANSI terminal injection sanitization in handoff and git metadata (#292)

**Bug Fixes**
- GCA on-demand review configuration fixes (#278, #282)
- GitHub Copilot lesson export confirmed working via existing `config.exports` (#294)
