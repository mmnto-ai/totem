## Lesson — Move large imports, such as multi-line prompt templates,

**Tags:** performance, cli, nodejs

Move large imports, such as multi-line prompt templates, inside function bodies to prevent eager parsing at module load time. This improves CLI responsiveness by ensuring heavy strings are only processed when the specific command is actually invoked.
