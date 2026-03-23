## Lesson — Using input strings as Map keys in batch processing

**Tags:** architecture, api-design, typescript

Using input strings as Map keys in batch processing functions causes data loss when duplicate inputs are provided. Returning an array of results mapped to input indices ensures every call is uniquely handled and preserved.
