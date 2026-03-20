## Lesson — When implementing custom glob matching for dir/\*/.ext,

**Tags:** architecture, curated
**Pattern:** \.(?:(?:includes|startsWith)\s*\(\s*['"]\*\*['"]|indexOf\s*\(\s*['"]\*\*['"]\s*\)\s*(?:>=\s*0|>\s*-1|!==?\s*-1|===?\s*0))
**Engine:** regex
**Scope:** **/\*.ts, **/\*.js
**Severity:** error

When implementing glob matching for '\*\*', ensure the index check excludes the start of the string (index 0). Use 'indexOf(...) > 0' to avoid misinterpreting repo-relative paths as root-anchored.
