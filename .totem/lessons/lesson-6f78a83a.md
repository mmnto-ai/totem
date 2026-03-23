## Lesson — Mixed batches of fast local tasks and slow remote tasks

**Tags:** performance, concurrency

Mixed batches of fast local tasks and slow remote tasks can bottleneck parallelism because fast tasks occupy concurrency slots. Partitioning tasks by type ensures the concurrency limit applies to the actual heavy workload.
