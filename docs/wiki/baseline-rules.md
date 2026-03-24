# Baseline Rules

Totem ships with curated architectural invariants mined from elite engineering teams, broken down into language-specific and ecosystem-specific packs.

## Universal Baseline

The Universal Baseline contains 50+ language-agnostic rules covering general architectural hygiene, secret management, and git workflows.

## Language Packs

Ecosystem detection is additive. If you have a monorepo with multiple languages, Totem will install multiple packs.

- **Python:** 8 baseline rules covering PEP 8 conventions, fast-fail execution, and error handling.
- **Rust:** 8 baseline rules covering borrow-checker patterns, error propagation (`Result<T, E>`), and macro safety.
- **Go:** 8 baseline rules covering goroutine safety, channel management, and standard library conventions.

_Note: Non-JS baseline packs ship without pre-compiled rules. You must run `totem compile` to generate the deterministic rules for these ecosystems._
