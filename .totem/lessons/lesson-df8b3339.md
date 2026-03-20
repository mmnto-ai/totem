## Lesson — Wrap user-controlled fields like PR descriptions

**Tags:** security, curated
**Pattern:** (?=.*\$\{.*(?:description|comment|body|user_?input|userInput).*\})(?!.*untrusted[ _-]content)
**Engine:** regex
**Scope:** **/prompts/**/*, **/ai/**/*, **/llm/**/*, **/*prompt*
**Severity:** error

User-controlled fields (like PR descriptions or comments) must be wrapped in XML tags explicitly labeled as 'untrusted content' to prevent prompt injection.
