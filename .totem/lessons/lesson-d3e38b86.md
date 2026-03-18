## Lesson — Using synchronous file operations like fs.readFileSync

**Tags:** nodejs, performance, io

Using synchronous file operations like `fs.readFileSync` inside an asynchronous execution loop blocks the Node.js event loop and degrades system throughput. Always use `fs.promises.readFile` when the surrounding context is already asynchronous.
