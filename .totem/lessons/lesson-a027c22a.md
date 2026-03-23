## Lesson — Using parseInt() allows malformed strings like '5foo' to be

**Tags:** cli, typescript, validation

Using `parseInt()` allows malformed strings like '5foo' to be parsed as integers, hiding configuration typos. Using `Number()` or regex validation ensures CLI flags reflect the user's explicit intent.
