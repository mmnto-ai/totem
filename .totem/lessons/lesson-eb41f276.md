## Lesson — Core packages should provide a logging interface and DI

**Tags:** architecture, logging, adr-071

Core packages should provide a logging interface and DI contract instead of calling console methods directly to prevent unwanted stdout pollution in non-CLI environments.
