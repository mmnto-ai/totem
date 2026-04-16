# @totem/pack-agent-security

Zero-Trust Agent Governance security pack for Totem. Flagship consumer of the Totem Pack Ecosystem (ADR-085) and the first production pack under the `@totem` scope.

## Status

Scaffolding only. The pack ships with an empty rules array at this stage. Rule content lands in follow-up PRs that implement the four attack surfaces defined in ADR-089:

1. Unauthorized process spawning outside known build paths.
2. Dynamic code evaluation with non-literal arguments.
3. Network requests to hardcoded IP addresses or suspicious domains.
4. Obfuscated string concatenation used to assemble shell commands or URLs at runtime.

See [ADR-089](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-089-zero-trust-agent-governance.md) for the full decision.

## Coverage boundaries (honest framing)

This pack is a baseline, not a comprehensive prompt-injection defense. Its rules target four high-signal attack categories in the Node.js ecosystem. A determined attacker using novel vectors (DNS exfiltration, environment-variable manipulation, vectors not yet modeled) may bypass these rules. The pack is intentionally narrow so that its enforcement is deterministic and false-positive rate on legitimate code stays near zero.

Future releases expand coverage as attack vectors evolve. Language coverage starts with TypeScript and JavaScript; Python, Go, and Rust are follow-on work.

## Install

Will land with `totem install pack/agent-security` once the pack resolver ships. See `mmnto-ai/totem#1491`.

## License

MIT. Same as the Totem monorepo.
