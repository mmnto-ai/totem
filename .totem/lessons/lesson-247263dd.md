## Lesson — Warning messages triggered by security violations

**Tags:** security, curated
**Pattern:** \.(?:warn|error|log)\(\s*[`'].*(?:security|malicious|violation|illegal|invalid|attack)._\$\{(?!sanitize|escape|encode|strip)[^}]+\}
**Engine:** regex
**Scope:** \*\*/_.ts, **/\*.js, **/_.tsx, \*\*/_.jsx
**Severity:** error

Sanitize or wrap offending input variables in security warning messages to prevent injection attacks (e.g., terminal escape sequences).
