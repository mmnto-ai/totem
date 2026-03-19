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

## Threat Model

Totem is a **local-first developer tool**. Its trust boundary is the local machine and the developer's filesystem permissions.

**Totem trusts:**

- The local user running the CLI
- AI agents operating under that user's session (same trust level as the user)
- Lesson content written by the user or extracted from their PRs
- Config files in the project directory (`totem.config.ts`, `.env`)

**Totem does NOT provide:**

- Authentication or authorization between users
- Network-level access control for the MCP server
- Isolation between linked repositories (see Totem Mesh below)

This means: if a user has filesystem access to a project, they (and their AI agents) have full access to that project's Totem knowledge. This is by design — Totem is an integrity mechanism for your own workflow, not a security boundary between threat actors.

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

### Core Protections

- **No secrets in config files** — API keys are read from environment variables only
- **Model name validation** — all model strings are validated against `/^[\w./:_-]+$/` to prevent shell injection
- **Git hook safety** — hooks never use `--no-verify` or bypass signing
- **Compiled rules are deterministic** — `totem lint` runs zero-LLM regex/AST checks with no network calls
- **Secret masking** — `maskSecrets()` strips API keys, tokens, and credentials before embedding into the vector index
- **Process cleanup** — spawned child processes use process groups on Unix and `taskkill /T /F` on Windows for clean tree-kill on timeout

### MCP Server Security (audited v1.3.1)

- **Input validation:** All MCP tool inputs validated via Zod schemas
- **Query limits:** `max_results` capped to 100 to prevent memory exhaustion
- **Output capping:** Subprocess output capped to 10KB in both `add_lesson` and `verify_execution`
- **Timeouts:** 60s for sync operations, 30s for lint
- **No filesystem writes** beyond lesson files in `.totem/lessons/`
- **SQL injection:** LanceDB queries use Zod enum-validated type filters — string interpolation is safe given the enum constraint

### Shell Orchestrator Security (audited v1.3.1)

- **Model name injection:** `MODEL_NAME_RE = /^[\w./:_-]+$/` blocks all shell metacharacters (`$`, backticks, `;`, `|`, `&`, parentheses). Subshell injection via model names is not possible.
- **Command template:** The shell command template comes from `totem.config.ts`, which has the same trust level as the codebase itself
- **Process termination:** Uses safe child process execution (`execFileSync`/`spawn`) with argument arrays (not string interpolation) for `taskkill` on Windows

### Totem Mesh (Cross-Repo Linking)

When you run `totem link <path>`, the linked repository's lessons become queryable by AI agents operating in your project via the MCP server. This means:

- An agent in your project can read lessons from the linked repository
- If the linked repository contains private/corporate knowledge, that knowledge is accessible to the agent
- The agent could theoretically surface this knowledge in generated code or logs

**Mitigation:** `totem link` displays a security warning about cross-trust-boundary access. Do not link private organizational knowledge bases to public or untrusted repositories.

**Future:** Proposal 067 describes RBAC and index isolation for a future cloud control plane. The local CLI will maintain its zero-auth posture.

### Known Acceptable Risks

- **Diff path traversal:** `extractAddedLines` parses file paths from `git diff` headers. `applyAstRulesToAdditions` reads those files via `path.resolve(cwd, file)`. A crafted diff with absolute paths or `../` traversal could escape the project directory — `path.resolve` does not enforce containment. Mitigated by: diffs come from `git diff` (trusted), not user input. A future hardening step could add a containment check (`resolvedPath.startsWith(cwd)`).
- **Lesson prompt injection:** Lessons are included in LLM prompts for spec/shield. A malicious lesson could inject instructions. Mitigated by: lessons are authored by the same user who controls the config. `sanitize()` strips ANSI codes, control characters, and BiDi overrides.
- **LLM response parsing:** `parseCompilerResponse` extracts JSON from LLM output. Malformed responses return `null` (fail-safe).
