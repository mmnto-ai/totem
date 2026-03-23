## Lesson — Prefer shell redirection over cat pipe

**Tags:** shell, performance, dx

Using redirection (`< file`) instead of `cat file |` avoids spawning an unnecessary process, which is a key best practice for keeping automation scripts lightweight. This optimization reduces resource overhead in high-frequency CI pipelines and complex shell integrations.
