## Lesson — Applying custom patterns before built-in ones prevents

**Tags:** dlp, architecture

Built-in DLP patterns run before custom user-defined patterns to ensure high-confidence secrets are always caught. Custom patterns use the `[REDACTED_CUSTOM]` tag to distinguish their redactions from built-in `[REDACTED]` tags, maintaining provenance in the output.
