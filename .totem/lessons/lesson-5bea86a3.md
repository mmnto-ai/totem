## Lesson — Check for the presence of the 'g' flag before appending it

**Tags:** architecture, curated
**Pattern:** new\s+RegExp\s*\([^,]+,\s*[^?:]_\+\s_['"]g['"]
**Engine:** regex
**Scope:** **/\*.js, **/_.ts, \*\*/_.jsx, **/\*.tsx
**Severity:\*\*\*\* error

Check for the presence of the 'g' flag before appending it; re-adding a global flag to a pattern that already includes it causes a runtime SyntaxError.
