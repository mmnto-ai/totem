## Lesson — Standard string length checks like .min(1) fail to catch

**Tags:** validation, zod, dx

Standard string length checks like `.min(1)` fail to catch whitespace-only inputs, which can lead to empty-looking entries in data stores. Always apply `.trim()` before length assertions in Zod schemas to ensure meaningful content is provided.
