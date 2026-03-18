## Lesson — When parsing git diff output, target the b/ destination

**Tags:** git, regex, cli

When parsing `git diff` output, target the `b/` destination path and account for quoted strings to ensure accuracy. This prevents failures when handling file renames or paths containing spaces, which standard simple regexes often miss.
