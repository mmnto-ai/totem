## Lesson — Omit shell:true when spawn args are arrays

**Tags:** security, nodejs, subprocess

Omit the `shell: true` option in `spawn()` calls when arguments are already provided as a parameterized array. Removing the shell layer eliminates shell injection vulnerabilities and reduces execution overhead.
