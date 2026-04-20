# The Pipeline Engine

Totem 1.9.0 introduces the Pipeline Engine, the core subsystem that governs how institutional knowledge (lessons) becomes deterministically enforced code constraints (rules).

The Pipeline Engine is built around the **Create → Enforce Lifecycle**. It moves Totem from a simple linter to a structural governance platform.

## The Pipelines (P1–P5)

Totem supports five distinct pipelines for rule creation, from zero-LLM manual authoring to fully autonomous observation capture.

| Pipeline | Name                     | LLM Required?        | Entry Point                                                                                                        |
| -------- | ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **P1**   | Manual Rules             | No                   | `totem rule scaffold` → author lesson → `totem lesson compile`                                                     |
| **P2**   | LLM-Generated            | Yes                  | `totem lesson compile` (from extracted lessons)                                                                    |
| **P3**   | Example-Based            | Yes                  | `totem lesson compile` (from Bad/Good code snippets in `.totem/lessons/*.md`)                                      |
| **P4**   | Import                   | No                   | `totem import --from-eslint`, `totem import --from-semgrep`                                                        |
| **P5**   | Observation Auto-Capture | No (at capture time) | Opt-in on `totem review` via `--auto-capture` (off by default; captured rules are context-less and apply globally) |

## Priority Order and Strategy

When establishing rules, prefer pipelines in the following order: **P1 > P3 > P2**. Pipelines **P4** and **P5** are additive enhancers.

1. **P1 (Manual):** The highest priority. If you know exactly what regex or AST pattern you want to block, write it by hand. It requires zero LLM API cost and runs instantaneously. It is also immune to prompt drift.
   - _Use when:_ You have a strict, highly specific pattern (e.g., `process.exit()`).
2. **P3 (Example-Based):** The next best option. If you don't know how to write an AST selector but you have clear examples of the "Wrong Way" and the "Right Way," P3 uses an LLM once to generate the deterministic rule for you.
   - _Use when:_ You can easily provide `bad.ts` and `good.ts` snippets in your Markdown lesson.
3. **P2 (LLM/Sonnet):** Fallback. Generates rules from prose explanations in extracted lessons. Powered by Claude Sonnet 4.6. Highly capable but requires well-written lessons.
   - _Use when:_ Rules are derived from PR review feedback where strict examples weren't provided.
4. **P4 (Import):** The bootstrapping pipeline. Use this on Day 1 to suck in your existing `eslint-plugin-no-restricted-syntax` configurations into the fast Totem engine.
5. **P5 (Observation Capture):** Opt-in auto-capture. When invoked with `totem review --auto-capture`, P5 extracts the flagged line into a `severity: warning` rule. Default is off because captured rules are context-less and apply globally; enable per-invocation only when you want to seed rules from the current review pass.

## Usage Examples

### Pipeline 2: Telemetry-Driven Upgrades

You can upgrade noisy regex rules using context telemetry. Run `totem compile --upgrade <hash>` to target a specific rule.

- **Semantics:** Evicts only that rule from the cache (preserves `createdAt` metadata), recompiles through Sonnet with a telemetry-driven directive, and replaces the rule.
- **Fail-safe:** Rejects `--cloud` (still routed to Gemini until #1221 ships) and `--force` (scoped eviction makes `--force` redundant and dangerous).
- **Outcome:** Returns an `UpgradeOutcome { hash, status }` shape to callers (`runSelfHealing` only counts 'replaced' outcomes as actual upgrades).

### Pipeline 1: Manual Scaffolding

Create the structure and write the AST selector yourself:

```bash
totem rule scaffold --id no-console --severity error
```

Then, author the lesson markdown and run `totem lesson compile` to generate the deterministic rule.

### Pipeline 3: Example-Based Compilation

Given a lesson (`.totem/lessons/db-access.md`) with explicit blocks:

````markdown
## Lesson - Direct DB access is forbidden in UI components

**Wrong:**

```typescript
import { db } from '@/lib/db';
```
````

**Right:**

```typescript
import { fetchUsers } from '@/lib/api';
```

Run compilation:

```bash
totem lesson compile
```

Totem will leverage the LLM (P3) to infer the exact structural constraint from your examples and persist it as a deterministic rule.

### Pipeline 4: Importing Rules

Instantly ingest your team's historical ESLint restrictions into the fast, deterministic Totem engine:

```bash
totem import --from-eslint ./eslint.config.mjs
totem rule list
```

The ESLint adapter imports these rule types:

- `no-restricted-imports`: import paths and patterns
- `no-restricted-globals`: global variable usage
- `no-restricted-properties`: object.property pairs (dot, optional chaining, and bracket notation)
- `no-restricted-syntax`: these three AST node types are ForInStatement, WithStatement, and DebuggerStatement (other selectors are silently skipped)

The Semgrep adapter (`--from-semgrep`) imports pattern-based YAML rules.

### Pipeline 5: Auto-Capture

Run review with `--auto-capture` to stage flagged lines as warnings in your rule list. Default is off.

```bash
totem review --auto-capture
```

_(Auto-capture will resume as a default once ADR-091 Stage 2 Classifier and Stage 4 Codebase Verifier ship in 1.16.0 and the LLM-emitted rule loop has gates that prevent context-less emissions.)_
