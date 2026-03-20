## Lesson — Windows requires shell:true for git binary resolution

**Tags:** architecture, curated
**Pattern:** execFileSync\s*\(\s*['"]git['"](?![^)]_shell:\s_(?:true|IS_WIN))
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx
**Severity:\*\* warning

Use { shell: true } or { shell: IS_WIN } when calling the 'git' binary with execFileSync to ensure it resolves correctly on Windows.
