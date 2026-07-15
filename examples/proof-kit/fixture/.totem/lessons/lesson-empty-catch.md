## Lesson — Empty catch blocks swallow failures

Tags: error-handling, architecture
Severity: error — a swallowed failure must block the push, never warn.

In 2026-06 the notification transport failed silently for three weeks: the
legacy retry helper wrapped `transport.send` in a try statement with an EMPTY
catch block, so every send error vanished without a log line. Nothing crashed,
nothing alerted — the failure mode was invisible until users reported missing
notifications. The repro is quarantined under `src/legacy/` as this rule's
positive control.

An empty catch block is forbidden in all JavaScript/TypeScript source
(`**/*.js`, `**/*.ts`) and must be a blocking error, never an advisory
warning. Every catch must rethrow, log, or route the error to the terminal
handler — failures fail loud.

Bad example (use this exact historical shape, verbatim, as the bad example):

```js
try {
  transport.send(message);
} catch {}
```

Good example (the same call handled loudly):

```js
try {
  transport.send(message);
} catch (err) {
  console.error('notify: transport.send failed', err);
  throw err;
}
```
