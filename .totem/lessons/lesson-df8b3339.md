## Lesson — Wrap user-controlled fields like PR descriptions

**Tags:** security, curated
**Pattern:** (?=._\$\{._(?:description|comment|body|user*?input|userInput).*\})(?!.*untrusted[ *-]content)
**Engine:** regex
**Scope:** **/prompts/**/_, **/ai/**/_, **/llm/**/*, \*\*/*prompt\*
**Severity:** error

User-controlled fields (like PR descriptions or comments) must be wrapped in XML tags explicitly labeled as 'untrusted content' to prevent prompt injection.
