# Reliability Model

Totem operates on an architectural separation of concerns designed to ensure that failures in probabilistic systems (LLMs, vector embeddings) cannot compromise deterministic enforcement (Git hooks, CI gates).

## The Air-Gap

The system is divided into two distinct layers: the **Semantic Overlay** and the **Deterministic Substrate**.

### The Semantic Overlay

This layer handles knowledge discovery and rule generation. It is inherently probabilistic and susceptible to drift, timeouts, and state corruption.

- **Vector Index (LanceDB):** Used by AI agents to retrieve context (`search_knowledge`).
- **The Compiler:** Uses an LLM to translate markdown lessons into AST/Regex rules.
- **Exemption Ledger:** The state files (`.totemignore`, `exemptions.json`) that track developer bypasses.

### The Deterministic Substrate

This layer handles the actual enforcement of rules. It contains zero API calls, zero LLM execution, and zero fuzzy matching.

- **Tree-sitter & Regex:** The engines that evaluate the code.
- **`compiled-rules.json`:** The static artifact representing the ground truth.
- **`totem lint`:** The offline, fast execution binary triggered by Git hooks.

## Failure Modes & Resilience

Because the Deterministic Substrate is isolated from the Semantic Overlay, the enforcement layer remains intact even when the overlay degrades.

- **Ghost AST Rules:** If the compiler generates a syntactically valid Tree-sitter S-expression that references a non-existent node type in the target language, `totem lint` will emit a warning and silently skip the specific rule. The process does not crash, and the remaining rules continue to enforce.
- **Semantic Corruption (Bad Regex):** If the compiler generates an overly broad regex, the blast radius is naturally limited by the diff-scoping engine. Violations are only flagged if the match overlaps with lines modified in the current Git diff, preventing a bad rule from flagging the entire repository.
- **Malformed Exemption State:** If the shared `exemptions.json` ledger is manually edited and contains invalid JSON, the lint engine emits a parsing error and ignores the file. It treats the file as empty — exemptions are not applied, so enforcement becomes stricter rather than permissive.
- **Context Entropy:** If a lesson in the vector index becomes stale or contradicts current architecture, it only impacts the context delivered to the AI agent during drafting. The `totem lint` engine does not read from the vector index; it enforces strictly against the `compiled-rules.json` artifact, maintaining the physical block regardless of semantic drift.

_Findings derived from the 1.6.0 workflow stress test._
