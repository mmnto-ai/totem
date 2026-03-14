## Lesson — When transitioning from a monolithic file

**Tags:** architecture, migrations, storage

When transitioning from a monolithic file to a directory-based structure, implement a dual-read/single-write strategy to ensure backward compatibility. This allow the system to process legacy data while ensuring all new records are created in the updated format.
