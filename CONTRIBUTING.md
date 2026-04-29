# Contributing to Totem

Thanks for your interest in contributing to Totem! This guide covers everything you need to get started.

## Getting Started

1. **Fork** the repository and clone your fork
2. Install dependencies: `pnpm install`
3. Build all packages: `pnpm build`
4. Run tests: `pnpm test`

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass: `pnpm test`
4. Ensure code is formatted: `pnpm format:check` (fix with `pnpm run format`)
5. Ensure linting passes: `pnpm lint`
6. Open a Pull Request against `main`

## Code Style

- TypeScript strict mode
- `kebab-case.ts` for files
- Use `err` (never `error`) in catch blocks
- No empty catch blocks
- Extract magic numbers into named constants

## Package Structure

```
packages/
  core/   @mmnto/totem   Core library (LanceDB, chunking, compiler)
  cli/    @mmnto/cli     CLI commands
  mcp/    @mmnto/mcp     MCP server
```

## Strategy Repo Expectations

A handful of Totem surfaces consult a sibling **strategy repo** (`mmnto-ai/totem-strategy`) for ADRs, proposals, journals, and the federated knowledge index:

- `totem proposal new` / `totem adr new` scaffolding
- MCP `describe_project` rich-state pointer
- Federated `search_knowledge` (the strategy linked-index is auto-injected when resolvable)
- The `scripts/benchmark-compile.ts` and `scripts/bench-lance-open.ts` benchmarks

The path is resolved by `resolveStrategyRoot` (see `packages/core/src/strategy-resolver.ts`) in this precedence order:

1. `TOTEM_STRATEGY_ROOT` env var (`STRATEGY_ROOT` accepted as a legacy alias).
2. `strategyRoot` field in `totem.config.ts`.
3. Sibling clone at `../totem-strategy/` next to your totem checkout.
4. Legacy `.strategy/` submodule at the totem checkout root.

**Recommended setup for new contributors:** clone `mmnto-ai/totem-strategy` as a sibling directory:

```bash
cd <parent-of-totem>
git clone https://github.com/mmnto-ai/totem-strategy.git
```

This gives you the full surface without the submodule ceremony. If the strategy repo isn't present, the affected commands degrade with actionable error messages — they don't silently fail. Run `totem doctor` to see which surfaces are affected.

## Contributor License Agreement (CLA)

All contributors must sign our [Contributor License Agreement](.github/CLA.md) before their first Pull Request can be merged. This is a one-time requirement.

**Why?** The CLA ensures that the project maintainers have the necessary rights to distribute and relicense contributions. This is standard practice for Apache 2.0 licensed projects that may offer additional licensing options in the future.

**How?** When you open your first PR, the CLA Assistant bot will post a comment asking you to sign. Simply reply with:

> I have read the CLA Document and I hereby sign the CLA

Once signed, the bot remembers your signature for all future PRs.

## Reporting Issues

- Use [GitHub Issues](https://github.com/mmnto-ai/totem/issues) for bugs and feature requests
- Check existing issues before creating a new one
- Include reproduction steps for bugs

## Questions?

Open a [Discussion](https://github.com/mmnto-ai/totem/discussions) or reach out in an issue.
