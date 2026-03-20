## Lesson — Custom .env parsers must strip CRLF and quotes

**Tags:** architecture, curated
**Pattern:** \bprocess\.env\[[^\]]+\]\s*=\s*(?![^;\n]_(\?\?|\|\||process\.env))
**Engine:** regex
**Scope:** **/cli/**/_.ts, **/cli/**/_.js, !\*\*/_.test.ts
**Severity:** error

Custom .env parsers must not override existing process.env keys (use ??= or ||=). Ensure you also strip CRLF (\r) and surrounding quotes from values.
