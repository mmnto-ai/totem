## Lesson — Avoid re-filtering static data collections inside functions

**Tags:** performance, optimization, typescript

Avoid re-filtering static data collections inside functions that are called frequently or on an interval. Pre-calculating filtered subsets at the module level prevents unnecessary CPU cycles and improves the responsiveness of CLI UI updates.
