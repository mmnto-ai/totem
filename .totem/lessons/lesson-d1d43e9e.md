## Lesson — Use byte-level binary size checks

**Tags:** bash, ci, build, workflow
**Scope:** packages/cli/build/*.sh, .github/workflows/*.yml, .github/workflows/*.yaml
**Pattern:** `\[\[?\s*"?\$[A-Z_]*MB[A-Z_]*"?\s+-(?:gt|ge|lt|le|eq|ne)\s+\d+`
**Engine:** regex
**Severity:** error

When enforcing binary size limits — including shell blocks embedded in GitHub Actions workflow YAML — never compare a megabyte-truncated variable (e.g. `$MB` or `$SIZE_MB`) against a numeric limit. Integer division truncates, so a 90.9 MB binary becomes `MB=90` and slips past a `[ "$MB" -gt 90 ]` check. Define byte-valued threshold variables (e.g. `HARD_LIMIT=$((90 * 1024 * 1024))`) and compare the raw byte count (`$SIZE`, `$BYTES`) against them. Computing `MB` for display is fine; comparing it is not.

**Example Hit:** `if [ "$MB" -gt 90 ]; then echo too big; fi`
**Example Miss:** `if [ "$SIZE" -gt "$HARD_LIMIT" ]; then echo too big; fi`
