## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** style, curated
**Pattern:** \bPromise\.all\(
**Engine:** regex
**Scope:** **/scripts/**/_.ts, **/scripts/**/_.js, **/tasks/**/_.ts, **/tasks/**/_.js, **/maintenance/**/_.ts, **/maintenance/**/_.js, **/jobs/**/_.ts, **/jobs/**/_.js
**Severity:** warning

Prefer sequential for...of loops over Promise.all for background maintenance tasks to simplify error isolation and allow per-item error handling.
