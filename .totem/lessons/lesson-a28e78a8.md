## Lesson — Empty catch blocks during file discovery can lead

**Tags:** architecture, testing, nodejs

Empty catch blocks during file discovery can lead to incomplete data sets that trigger incorrect downstream logic, such as downgrading rule severity based on "missing" tests. Explicit error handling is necessary to distinguish between a missing directory and a failure to read valid configurations.
