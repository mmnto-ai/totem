## Lesson — When timing out a child process, do not reject the promise

**Tags:** architecture, curated
**Pattern:** \bsetTimeout\s*\(.*?\breject\b
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** error

Do not reject a promise directly inside a setTimeout callback when timing out a child process. Call child.kill() and perform the rejection inside the 'close' event handler to ensure stdio streams are fully flushed.
