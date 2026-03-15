## Lesson — Git output wraps file paths in double quotes if they

**Tags:** git, filesystem, parsing

Git output wraps file paths in double quotes if they contain spaces or special characters. Parsers must detect and strip these quotes to correctly resolve the actual file system path during automated tasks.
