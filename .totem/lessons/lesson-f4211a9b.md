## Lesson — Calling .test() on a global regex increments the lastIndex

**Tags:** javascript, regex, security

Calling `.test()` on a global regex increments the `lastIndex` property, which causes subsequent replacements to skip characters and can allow malicious content to bypass sanitization.
