# @mmnto/cli

Command-line interface for [Totem](https://github.com/mmnto-ai/totem), a persistent memory and context layer for AI coding agents. Installs the `totem` binary.

## Install

```bash
pnpm add -D @mmnto/cli
# or run without installing
pnpm dlx @mmnto/cli init
```

Requires Node >= 24.

## Usage

```bash
totem init             # scaffold totem.config.ts, git hooks, and baseline rules
totem lint             # run compiled rules against your changes (zero LLM, offline)
totem lesson compile   # compile markdown lessons into regex/AST rules (needs an LLM key)
totem lesson extract   # extract lessons from PR reviews (needs an LLM key)
totem sync             # rebuild the semantic index (needs an embedding key)
totem --help           # full command list
```

`totem init`, `totem lint`, and the git hooks run with no API keys. LLM-backed commands (`lesson compile`, `lesson extract`, `review`, `spec`) use the orchestrator configured in `totem.config.ts`; the Anthropic, OpenAI, and Google SDKs are optional peer dependencies loaded only when configured.

## Docs

- Repository: <https://github.com/mmnto-ai/totem>
- Architecture: [docs/reference/architecture.md](https://github.com/mmnto-ai/totem/blob/main/docs/reference/architecture.md)
- CLI reference: [docs/wiki/cli-reference.md](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/cli-reference.md)

Apache-2.0.
