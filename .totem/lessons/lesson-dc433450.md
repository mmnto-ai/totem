## Lesson — Totem is Agent Governance, not an AI documentation writer

**Tags:** product-positioning, messaging, readme, totem-docs, strategy

# Totem is Agent Governance, not an AI documentation writer

## What happened
The `totem docs` command was being positioned alongside `lint`, `shield`, and `extract` as a core feature. This confused the product pitch — solo devs thought they needed LLM API keys to use Totem. The real core product is the deterministic Enforce tier (lessons → compile → lint → hooks) which requires zero AI at runtime.

## Rule
Never pitch `totem docs` as a core feature in user-facing copy (README, landing pages, quickstart guides). The core pitch is: "Write what you learned. It never happens again." — referring to the Enforce tier. Doc generation is a Tier 4 power-user feature for maintaining roadmap/active_work documents only.

See ADR-078 for the official 5-tier product model.

**Source:** mcp (added at 2026-03-27T21:24:26.248Z)
