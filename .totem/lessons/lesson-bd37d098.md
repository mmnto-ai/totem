## Lesson — Gemini CLI hook registration semantics (leg-verified)

**Tags:** gemini-cli, hooks, trap, fail-open, settings-json, vendor-semantics

**Applies-to:** boundary, infrastructure

Gemini CLI hook registration semantics (leg-verified against @google/gemini-cli@0.54.4, 2026-08-08, mmnto-ai/totem#2610 falsification round — receipts on the PR and mmnto-ai/totem#2611):

1. SessionStart matchers are EXACT-STRING against the trigger ("startup"/"resume"/"clear") — only "" or "*" pass-through. A regex-looking matcher like ".*" silently never fires, while the CLI still prints the "hooks will be executed" trust banner and records the hook in ~/.gemini/trusted_hooks.json: it LOOKS armed and is not. Tool-event matchers (BeforeTool) ARE real regexes against tool names. Use matcher "" (or omit).

2. Hook entries MUST be the nested {matcher, hooks: [{type: "command", command}]} shape — flat {name, type, command} entries are discarded by processHookDefinition without error. The "flat command shape too" fixture in install-hooks-exit-contract.test.ts is a migration INPUT, not a registration-shape contract.

3. Command-hook exit contract: exit 0 = allow, exit 1 = ALLOW with warning (an uncaught Node throw exits 1, so throw-on-violation fails OPEN), exit >= 2 = deny, or structured stdout {"decision":"deny","reason":...}. A guard must emit the decision or exit >= 2 — never rely on throwing.

4. A module.exports-shaped script registered as a command hook is a NO-OP (defines a function, exits 0, empty output = allow). Gemini has NO filename-convention discovery of .gemini/hooks/ — registration is the only execution path. This is why the distributed GEMINI_BEFORE_TOOL write-guard has never been able to fire as a hook (mmnto-ai/totem#2611).

5. $GEMINI_PROJECT_DIR in a hook command expands to the same value as the spawn cwd, so "node .gemini/hooks/X.cjs" (relative) resolves identically to the $GEMINI_PROJECT_DIR form.

**Source:** mcp (added at 2026-08-09T04:42:12.078Z)
