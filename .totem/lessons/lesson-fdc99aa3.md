## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** style, curated
**Pattern:** \bPromise\.all\(
**Engine:** regex
**Scope:** **/scripts/**/*.ts, **/scripts/**/*.js, **/tasks/**/*.ts, **/tasks/**/*.js, **/maintenance/**/*.ts, **/maintenance/**/*.js, **/jobs/**/*.ts, **/jobs/**/*.js
**Severity:** warning

Prefer sequential for...of loops over Promise.all for background maintenance tasks to simplify error isolation and allow per-item error handling.
