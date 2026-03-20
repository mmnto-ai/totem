## Lesson — Warning messages triggered by security violations

**Tags:** security, curated
**Pattern:** \.(?:warn|error|log)\(\s*[`'].*(?:security|malicious|violation|illegal|invalid|attack).*\$\{(?!sanitize|escape|encode|strip)[^}]+\}
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** error
