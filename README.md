# Totem

_AI coding agents are brilliant goldfish. Totem gives them a memory._

**Your AI agents keep making the same mistakes.** They're brilliant at the 100 lines in front of them, but terrible at asking: _"Does a shared helper already exist for this?"_

Every PR becomes a back-and-forth with review bots about the same architectural nits — missing lazy imports, improper error tagging, reinventing the wheel. That's the **"Bot-Tax."**

Write what you learned in plain English. Totem compiles it into a rule. That mistake physically cannot happen again.

## The Invisible Exoskeleton

Totem operates as a continuous, self-healing loop that converts institutional knowledge into physical constraints.

```mermaid
graph LR
    %% Styles
    classDef observe fill:#4b3a75,stroke:#9b72cf,stroke-width:2px,color:#fff
    classDef learn fill:#5e3a24,stroke:#e67c3b,stroke-width:2px,color:#fff
    classDef enforce fill:#1a4d2e,stroke:#34a853,stroke-width:2px,color:#fff
    classDef core fill:#2d2d2d,stroke:#888,stroke-width:1px,color:#fff

    Observe[1. The Eye <br> Observe]:::observe
    Learn[2. The Brain <br> Learn]:::learn
    Enforce[3. The Hand <br> Enforce]:::enforce
    Ledger[(Trap Ledger)]:::core

    Observe -->|PR Reviews<br/>Bot Nits| Learn
    Learn -->|totem compile<br/>Generate Rule| Enforce
    Enforce -->|totem lint<br/>pre-push hook| Observe

    Enforce -.->|Developer Bypass| Ledger
    Ledger -.->|Self-Healing Loop| Learn
```

1. **The Eye (Observe):** `totem shield` and your review bots (CodeRabbit, GCA) watch the code. What went wrong?
2. **The Brain (Learn):** `totem extract` captures the markdown lesson from the PR. `totem compile` automatically writes the AST/Regex plugin for you. What did we learn?
3. **The Hand (Enforce):** `totem lint` and Git Hooks physically block the push. Make it impossible to repeat.

## How a Mistake Becomes Impossible

Documentation is not enforcement. Telling an AI to "follow the style guide" in a README is a suggestion.

Totem translates a plain-English markdown lesson into a deterministic physical constraint:

**Input:** (`.totem/lessons/no-child-process.md`)

```markdown
## Lesson — Never use native child_process

Tags: architecture
Direct use of `node:child_process` is forbidden outside `core/src/sys/`. Use the `safeExec` shared helper instead.
```

**Output:** (`git push` blocked on the agent's machine)

```bash
$ git push
[Lint] Running 305 rules (zero LLM)...
### Warnings
- **packages/cli/src/git.ts:22** — Never use native child_process
  Pattern: `import { execSync } from 'node:child_process'`
  Lesson: "Direct use of `node:child_process` is forbidden outside `core/src/sys/`. Use the `safeExec` shared helper instead."
[Lint] Verdict: FAIL — Fix violations before pushing.
```

The "wrong" way becomes the "loud" way.

## COSS Covenant

**The simple rule: Single-repo local use is free. Multi-repo centralized governance is paid.**
Totem's enforcement engine (local pre-push lint, compiled rules, and the lesson $\rightarrow$ rule pipeline) is Apache-2.0 and will remain free and open. Federation, hosted compile/signing, centralized Trap Ledger ingestion, and enterprise dashboards are commercial features. See [COVENANT.md](./COVENANT.md) for full details.

## Quickstart

Initialize Totem in any project (Node, Python, Go, Rust):

```bash
pnpm dlx @mmnto/cli init
```

This scaffolds `totem.config.ts`, installs foundational baseline rules, and configures the `pre-push` git hook.

Run the enforcement engine (Zero-LLM, offline, fast):

```bash
pnpm dlx @mmnto/cli lint
```

## Documentation & Workflows

Stop reading manuals and start solving friction. See the Wiki for how to use Totem to govern your workflows:

- [**It Never Happens Again:**](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/it-never-happens-again.md) How to turn a PR mistake into a permanent project law in 60 seconds.
- [**Governing AI Agents:**](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/governing-ai-agents.md) How to use Smart Briefings and Hooks to lock down Claude and Gemini on Turn 1.
- [**It Stops Crying Wolf:**](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/it-stops-crying-wolf.md) How the Self-Healing Loop automatically downgrades noisy rules based on developer frustration.

### Deep Dives

- [CLI Reference](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/cli-reference.md)
- [Architecture & Workflows](https://github.com/mmnto-ai/totem/blob/main/docs/reference/architecture-diagram.md)
- [MCP Server Setup](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/mcp-setup.md)
- [CI/CD Integration](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/ci-integration.md)

## Open Core Covenant

**Single-repo local use is free. Multi-repo centralized governance is paid.** The enforcement engine, lesson pipeline, MCP server, and self-healing loop are Apache 2.0 and will remain free and open. See [`COVENANT.md`](https://github.com/mmnto-ai/totem/blob/main/COVENANT.md) for full details.

## License

Apache 2.0 License.
