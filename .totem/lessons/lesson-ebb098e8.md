## Lesson — Use process.argv.includes for early detection of global

**Tags:** cli, architecture

Use `process.argv.includes` for early detection of global flags like `--json` to ensure error envelopes are correctly formatted even if the primary argument parser fails.
