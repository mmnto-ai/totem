## Lesson — Using Array.prototype.find inside a loop results in O(N\*M)

**Tags:** typescript, performance, optimization

Using `Array.prototype.find` inside a loop results in O(N\*M) complexity, which can degrade performance as the number of rules grows. Indexing data into a `Map` before the loop ensures O(1) lookups and scales linearly.
