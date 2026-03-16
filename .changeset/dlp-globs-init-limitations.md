---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

feat: DLP secret masking — strip secrets before embedding (#534)

Automatically masks API keys, tokens, passwords, and credentials with [REDACTED] before entering LanceDB. Preserves key names in assignments. Handles quoted and unquoted patterns.

fix: compiler glob patterns — prompt constraints + brace expansion (#602)

Compiler prompt now forbids unsupported glob syntax. Post-compile sanitizer expands brace patterns. Fixed 12 existing rules.

fix: init embedding detection — Gemini first (#551)

Reorders provider detection to prefer Gemini (task-type aware) over OpenAI when both keys present.

fix: review blitz 2 — dynamic imports, onWarn, rule demotions (#575, #594, #595)

compile.ts dynamic imports, loadCompiledRules onWarn callback, err.message rule demoted to warning.

docs: Scope & Limitations section, Solo Dev Litmus Test styleguide rule
