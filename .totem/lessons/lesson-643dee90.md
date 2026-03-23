## Lesson — Use strict boundaries (like (\/|$)) or the URL class

**Tags:** security, networking, regex

Use strict boundaries (like `(\/|$)`) or the URL class when detecting local providers to avoid bypasses like `localhost.evil.com`. Relying on prefix matching for loopback addresses creates a security vulnerability where remote attackers can spoof local-only bypasses.
