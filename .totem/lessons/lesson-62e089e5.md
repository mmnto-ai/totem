## Lesson — Short, sequential startup tasks often do not require

**Tags:** clean-code, refactoring, yagni

Short, sequential startup tasks often do not require encapsulation into dedicated functions if they are limited in scope (e.g., under 15 lines). Deferring abstraction until complexity increases or reuse is required prevents unnecessary boilerplate and keeps the entry point's execution flow immediately visible.
