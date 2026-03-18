# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Totem, please report it responsibly.

**Do NOT open a public GitHub issue.**

Instead, email **security@mmnto.ai** with:

- A description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential impact assessment

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Scope

The following are in scope:

- **Prompt injection** via lesson content, compiled rules, or MCP tool inputs
- **Secret leakage** through logs, error messages, or generated files
- **Path traversal** in file operations (sync, compile, eject)
- **Command injection** via shell orchestrator or git operations
- **Supply chain** issues in published npm packages

The following are out of scope:

- Vulnerabilities in third-party LLM providers (OpenAI, Anthropic, Google, Ollama)
- Issues requiring physical access to the machine
- Social engineering attacks

## Security Design

Totem processes code diffs and sends them to LLM providers for analysis. Key security properties:

- **No secrets in config files** — API keys are read from environment variables only
- **Model name validation** — all model strings are validated against `/^[\w./:_-]+$/` to prevent shell injection
- **Git hook safety** — hooks never use `--no-verify` or bypass signing
- **Compiled rules are deterministic** — `totem lint` runs zero-LLM regex/AST checks with no network calls
