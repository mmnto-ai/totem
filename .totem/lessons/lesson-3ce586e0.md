## Lesson — Use the --recurse-submodules flag with git ls-files

**Tags:** architecture, curated
**Pattern:** \bgit\s+ls-files\b(?!._\b--recurse-submodules\b)
**Engine:** regex
**Scope:** \*\*/_.sh, **/\*.bash, **/_.js, \*\*/_.ts, **/\*.yml, **/\*.yaml
**Severity:** error

Use the --recurse-submodules flag with git ls-files to ensure submodule files are included in scans.
