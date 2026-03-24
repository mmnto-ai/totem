# Working with Shield

Totem Shield is an AI-powered code review and codebase immune system. It acts as a collaborative partner rather than a rigid gatekeeper, designed to catch architectural drift while remaining adaptable to the nuances of your specific changes.

## 1. How Shield Works and When it Runs

Shield reads your uncommitted diff (or specified branch) and compares it against both your compiled rules (`compiled-rules.json`) and your vector database of lessons (`.lancedb/`).

- **When it runs:** It is typically run manually via the `totem shield` command prior to opening a Pull Request.
- **How it differs from Lint:** `totem lint` runs deterministic, zero-LLM checks (AST/regex) in milliseconds during pre-push hooks. `totem shield` is a deeper, LLM-powered structural review.

## 2. Smart Auto-Hints

To prevent false positives, Shield automatically inspects the shape of your diff before requesting an LLM review. It dynamically injects context hints into the prompt:

- **DLP Artifacts:** If redacted strings (like `[REDACTED]`) are found in test fixtures, Shield is instructed not to flag them as broken credentials.
- **Test Files:** If test files are present in the diff, Shield receives a hint to avoid "missing tests" false positives for related source files.

## 3. Inline Annotations (`// shield-context:`)

You can provide surgical, inline instructions directly to the AI reviewer using the `// shield-context:` annotation.

If Shield flags a trivial wrapper or an intentional architectural exception, add a comment in your code:

```typescript
// shield-context: this is a thin interface wrapper, logic is tested via the integration suite
export function performAction() { ... }
```

This gives the AI the explicit reasoning it needs to approve the code without shutting off the rule entirely.

## 4. Suppressing False Positives

When deterministic checks or stubborn AI rules fail, you can bypass them entirely using inline suppression directives. These override both `totem lint` and `totem shield`.

- `// totem-ignore-next-line`: Ignores violations on the immediately following line.
- `// totem-ignore`: Ignores violations for the entire block or file depending on placement.

## 5. Overriding the Prompt (`.totem/prompts/shield.md`)

If you need to apply a repository-wide behavioral change to Shield, you can override its system prompt.
Create a `.totem/prompts/shield.md` file. Any text placed here will completely override the default instruction set for the `shield` command.

## 6. Debugging Shield

If you need to understand exactly what context Shield is receiving or how it is parsing your code, use the debugging flags:

- `--raw`: Prints the raw, unformatted LLM response and prompt assembly, allowing you to see the exact context injected.
- `--mode structural`: Forces Shield to focus purely on architectural and structural rules rather than stylistic nits.
