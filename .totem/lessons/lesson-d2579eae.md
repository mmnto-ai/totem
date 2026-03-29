## Lesson — Node's spawn() emits resolution errors via the 'error'

**Tags:** node, spawn, error-handling

Node's spawn() emits resolution errors via the 'error' event on the child process, meaning a standard try/catch block will fail to capture asynchronous failures like command-not-found.
