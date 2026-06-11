---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

Context-correct remediation for missing externalized LLM SDKs (mmnto-ai/totem#2018 L2). When `@google/genai` / `@anthropic-ai/sdk` / `openai` fail to import, the error now branches on what is actually true on disk: SDK installed but unresolvable from the running binary → points at the project-local CLI (`pnpm exec totem`) and names the global-install cause; totem workspace checkout → points at the workspace build; genuinely missing → project-local install hint with the externalized-by-design context. No branch suggests a global install — verified on #2018 to be a dead end.
