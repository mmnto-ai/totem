## Lesson — Using optional chaining for diagnostic callbacks

**Tags:** typescript, dx, logging

Using optional chaining for diagnostic callbacks like `onWarn?.()` can silently swallow critical failures if the caller omits the handler; providing a fallback to `console.warn` ensures visibility.
