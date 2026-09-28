## Lesson — A URL input is an issue URL or a refusal, never a qualified ref

**Tags:** manual, parsing, url

A URL input is an issue URL or a refusal, never a qualified ref: after the issue-URL form fails, an input beginning with http(s):// returns null before the owner/repo#N branch, because a URL ending in a hash and digits would otherwise be read as issue N of the whole URL and passed to gh --repo as a repository, bypassing every refusal by name (leg 2 on mmnto-ai/totem#2965).
