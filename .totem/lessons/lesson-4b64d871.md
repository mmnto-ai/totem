## Lesson — Include a space or delimiter when concatenating disjoint

**Tags:** architecture, curated
**Pattern:** (\$\{[^}]+\}\$\{[^}]+\}|\.join\(['"]{2}\))
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx
**Severity:\*\*\*\* error

Include a space or delimiter when concatenating disjoint text fragments to prevent 'keyword synthesis' and security filter bypass.
