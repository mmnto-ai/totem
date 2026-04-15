---
'@mmnto/totem': patch
---

Security: Reject shell-injecting `{model}` tokens in the shell orchestrator

The shell orchestrator used to interpolate `orchestrator.defaultModel` (and per-command overrides) directly into a command string that was then executed with `shell: true`. A poisoned config value like `"gemini-1.5; rm -rf /"` would run as shell. The `{file}` token was already shell-quoted; the `{model}` token was not.

**Fix is defense in depth:**

1. **Shared allow-list at the boundary.** The shell orchestrator now imports `MODEL_NAME_RE` from `orchestrator.ts` and applies the same leading-dash + allow-list check that `resolveOrchestrator` has always used. Single source of truth for model-name validation, symmetric across all orchestrators, no chance of one gate rejecting what another accepts. Validation errors throw `TotemConfigError` matching the sibling validator.
2. **Shell-quoting at interpolation.** Even after the allow-list passes, the model token is wrapped in shell-safe quotes (single-quote on Unix, MSVCRT-style `\"` escape on Windows) — same treatment the `{file}` token has always had. A future regression that drops the allow-list cannot re-open the hole alone.

**Regression tests added:** 12 exploit cases (semicolon, backtick, dollar-subshell, pipe, redirect, newline, ampersand, space, quote, dquote, paren, leading-dash) all rejected before `spawn()` is called. 8 benign model shapes accepted including underscore-containing ollama quantized tags. 1 defense-in-depth assertion that the model is quoted on the spawn command.

**Exposure assessment:**

Exploitable only when a user runs any `totem` command that reaches the shell orchestrator AND a poisoned `totem.config.ts` is present. Realistic vector: cloning a malicious repo and running `totem review` / `totem compile` / `totem spec` against it. Trusted-config users (single-developer, audited-config repos) were never at risk.

**Minor backward-compat note:**

Users whose `orchestrator.command` string manually wrapped `{model}` in quotes (e.g., `"--model=\"{model}\""`) will see the token double-quoted after this patch. The shell strips the outer quotes, so the final argv is identical, but if anyone has a custom command that depends on the raw unquoted substitution, they should drop the manual quotes from their template. Most users followed the existing `{file}` pattern (no manual quotes — Totem quotes for you), so this affects a narrow slice.

Thanks to Gemini for catching this in the pre-1.15.0 deep review.
