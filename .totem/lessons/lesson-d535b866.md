## Lesson — Convert top-level static imports to dynamic import() calls

**Tags:** cli, performance, nodejs

Convert top-level static imports to dynamic `import()` calls inside command handler functions to reduce CLI startup latency. This ensures the Node.js runtime only loads heavy dependency graphs and utility modules when the specific command requiring them is actually executed.
