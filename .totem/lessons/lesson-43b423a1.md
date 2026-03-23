## Lesson — When implementing data loss prevention, ensure the system

**Tags:** security, middleware, error-handling

When implementing data loss prevention, ensure the system throws an exception if the scanner fails rather than proceeding with the original text. This prevents unmasked sensitive data from leaking to external providers in the event of an internal processing failure.
