## Lesson — Wrap user-controlled fields like PR descriptions

**Tags:** security, curated
**Pattern:** (?=.*\$\{.*(?:description|comment|body|user_?input|userInput).*\})(?!.*untrusted[ _-]content)
**Engine:** regex
**Scope:** **/prompts/**/*, **/ai/**/*, **/llm/**/*, **/*prompt*
**Severity:** error

Wrap user-controlled fields like PR descriptions.
