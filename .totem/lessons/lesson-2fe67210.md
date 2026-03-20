## Lesson — When using the @google/genai SDK (v1+), the constructor

**Tags:** style, curated
**Pattern:** new\s+GoogleGenerativeAI\s*\(\s*[^\s\{]
**Engine:** regex
**Scope:** **/\*.ts, **/_.tsx, \*\*/_.js, **/\*.jsx
**Severity:\*\* warning

The @google/genai constructor requires an options object (e.g., { apiKey: '...' }) instead of a raw string.
