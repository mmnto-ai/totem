## Lesson — Labeling a prompt as "Regex Rule Extraction" biases models

**Tags:** llm, prompts, refactoring

Labeling a prompt as "Regex Rule Extraction" biases models toward text-based patterns even when structural engines like AST or ast-grep are more appropriate. Using neutral terminology like "Rule Extraction" ensures the model evaluates all supported engines and selects the narrowest technical representation.
