# LLM Parameter Tuning

When operating Totem or configuring custom LLM orchestrators (like local Ollama instances or custom API wrappers), understanding how Totem utilizes LLM "Temperature" is critical for maintaining a stable pipeline.

Totem interacts with LLMs across several different operational phases. Because the required output varies wildly between these phases (from strict JSON syntax to fluid natural language), Totem hardcodes different temperature profiles to ensure reliability.

## 1. Compilation: The Mechanical Path

**Target Command:** `totem lesson compile`
**Ideal Temperature:** `0.0`

The compilation step is not a creative task; it is a translation task. The goal is to convert a natural language lesson into a mathematically precise Tree-sitter S-expression or Regex pattern, and output it perfectly formatted as JSON.

- **Syntax Rigidity:** A temperature of `0.8` will cause the model to occasionally "invent" new AST syntax that doesn't exist, which breaks the `totem lint` parser.
- **Idempotency:** A low temperature ensures that if you hit `--force` to recompile a rule, the resulting AST JSON remains stable, preventing unnecessary churn in your Git history.
- **Schema Adherence:** Low temperatures force the model to rigidly adhere to the Zod JSON schema instructions, preventing it from hallucinating markdown fences or conversational preambles (e.g., "Here is your rule:").

## 2. Extraction: The Analytical Path

**Target Command:** `totem extract`
**Ideal Temperature:** `0.4`

Extraction requires the model to read a sprawling, messy GitHub Pull Request thread and synthesize it into a cohesive, single-sentence lesson.

- **Reasoning:** It requires enough "creativity" to look past the specific variable names in the diff and deduce the _architectural intent_ behind a code review comment.
- **Structure:** However, it still must return the output in a structured schema. `0.4` provides the perfect balance of analytical synthesis and structural obedience.

## 3. Documentation & Review: The Agentic Path

**Target Commands:** `totem docs`, `totem review` (future)
**Ideal Temperature:** `0.7`

When asking Totem to rewrite a `README.md` or summarize the codebase's current state, the model needs to sound human.

- **Fluency:** Higher temperatures allow the model to generate fluid, readable prose rather than robotic, repetitive lists.

## Summary for Bring-Your-Own-Model (BYOM)

If you are configuring a custom local model (e.g., passing a 32B Coder model to the `OllamaOrchestrator`), ensure your backend serves requests with the understanding that **Compilation requires absolute determinism**, while **Extraction requires analytical synthesis.**
