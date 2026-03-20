## Lesson — Custom .env parsers must strip CRLF and quotes

**Tags:** architecture, curated
**Pattern:** \bprocess\.env\[[^\]]+\]\s*=\s*(?![^;\n]*(\?\?|\|\||process\.env))
**Engine:** regex
**Scope:** **/cli/**/*.ts, **/cli/**/*.js, !**/*.test.ts
**Severity:** error
