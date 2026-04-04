## Lesson — Exclude 'pwd' from credential regexes

**Tags:** security, regex, nodejs
**Scope:** packages/cli/src/assets/*.ts

Credential-scanning regexes should avoid the 'pwd' keyword in Node.js environments to prevent false positives where it refers to the 'present working directory'.
