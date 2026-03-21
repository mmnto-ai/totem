## Lesson — Standard glob matchers often handle brace expansion

**Tags:** glob, nodejs, automation

Standard glob matchers often handle brace expansion inconsistently across different environments or library versions. Manually expanding groups like `{ts,tsx}` into discrete patterns before processing ensures comprehensive file coverage and prevents silent omissions in analysis pipelines.
