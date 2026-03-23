## Lesson — When dynamically generating XML fragments, the tag name

**Tags:** security, xml, validation

When dynamically generating XML fragments, the tag name itself must be validated against a strict regex to prevent attackers from injecting malformed markup via the tag parameter. Escaping content alone is insufficient if the surrounding tag can be manipulated.
