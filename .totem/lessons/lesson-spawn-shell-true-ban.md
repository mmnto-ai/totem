## Lesson — Ban `spawn()` / `spawnSync()` with `shell: true`

**Tags:** security, shell-injection, ast-grep-compound, governance
**Engine:** ast-grep
**Scope:** packages/**/*.ts, !**/*.test.ts, !**/*.spec.ts, !packages/cli/src/orchestrators/shell-orchestrator.ts
**Severity:** error
**Pattern:**

```yaml
rule:
  any:
    - pattern: spawn($$$)
    - pattern: spawnSync($$$)
  has:
    kind: pair
    pattern: 'shell: true'
    stopBy: end
```

**Message:** `spawn` / `spawnSync` with `shell: true` opens a shell-injection vector. Use `safeExec` (which routes through `cross-spawn.sync` without a shell) from `packages/core/src/sys/exec.ts` instead. The single legitimate exception — the shell orchestrator at `packages/cli/src/orchestrators/shell-orchestrator.ts` that pipes prompts to third-party CLI tools — is scope-excluded via `!` glob and has its own input-sanitization gate.

`shell: true` on Node's `child_process.spawn` / `spawnSync` concatenates argument strings into a shell command line. If any interpolated value contains shell metacharacters (`;`, `|`, `$(...)`, backticks, newlines, etc.), it runs as code. This is the exact class of RCE that mmnto/totem#1329 closed in 1.14.5 (`safeExec` rewrite) and mmnto/totem#1429 (the shell orchestrator `{model}` token hardening in 1.14.10).

The compound rule combines an `any:` disjunction over `spawn($$$)` and `spawnSync($$$)` call patterns with a `has:` descendant check for the `shell: true` pair in any options object. `stopBy: end` lets the descendant scan traverse the full argument subtree, so `shell: true` nested inside a destructured config or a spread still matches.

**The deliberate escape hatch (one site):** `packages/cli/src/orchestrators/shell-orchestrator.ts` legitimately needs `shell: true` to invoke arbitrary CLI tools (`gemini`, `claude`, `ollama`). That file is scope-excluded via the `!` glob entry. The input-sanitization that protects it lives in the same file (`MODEL_SAFE_RE` allow-list + `quoteShellArg` defense-in-depth) and was added in 1.14.10.

### Bad Example

```ts
import { spawn } from 'node:child_process';
spawn('ls -la', { shell: true });
```

### Good Example

```ts
import { safeExec } from '../sys/exec.js';
const result = safeExec('ls', ['-la']);
```

## Why this needs to be compound

A flat ast-grep pattern for `spawn(...)` matches every `spawn` call regardless of options, so it is too broad and would flag every legitimate `cross-spawn` usage. A pattern that literally spells out `spawn($CMD, { shell: true })` misses the three-argument form `spawn($CMD, $ARGS, { shell: true })` and doesn't cover `spawnSync`. The compound form — `any:` over the two call names, `has:` on `shell: true` descendants — encodes the real invariant: the danger is `shell: true` anywhere in the options, not the spawn call in isolation.

**Source:** Pre-1.15.0 deep review (mmnto/totem#1421). Gemini's teardown (`.strategy/audits/internal/2026-04-14-repomix-architectural-teardown.md`) identified this as the generalized form of the mmnto/totem#1329 and mmnto/totem#1429 fixes — a compound rule here prevents the bug class instead of only the specific incidents. First production compound rule using the `any:` disjunction operator.
