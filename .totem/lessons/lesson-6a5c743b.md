## Lesson — Using Array.prototype.reduce to categorize items

**Tags:** typescript, performance, optimization

Using `Array.prototype.reduce` to categorize items into multiple buckets (like errors and warnings) is more efficient than calling `.filter()` multiple times. This approach avoids redundant iterations over the collection, which is critical as the number of rules and violations scales.
