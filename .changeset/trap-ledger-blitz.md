---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

feat: Trap Ledger Phase 1 — SARIF extension + enhanced totem stats

Every `totem lint` violation now generates SARIF properties with eventId, ruleCategory, timestamp, and lessonHash. Rules support a `category` field (security/architecture/style/performance). `totem stats` shows "Total violations prevented" with category breakdown and top 10 prevented violations.

fix: code review blitz — 7 findings from Claude+Gemini synthesis

Critical: MCP loadEnv quote stripping, add_lesson race condition (promise memoization), SARIF format flag works with totem lint. High: extracted shared runCompiledRules (-75 lines), Gemini default model fixed, health check --rebuild → --full, lesson validation before disk write.

fix: stale prompts — docs glossary, init model, reflex block v3

Command glossary in docs system prompt prevents LLM confusing lint/shield. Gemini embedder model corrected in init. AI_PROMPT_BLOCK distinguishes lint (pre-push) from shield (pre-PR).

chore: 137 compiled rules (39 new), 17 extracted lessons, docs sync
