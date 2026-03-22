## Lesson — Core library modules should accept optional warning

**Tags:** api-design, core-library, dx

Core library modules should accept optional warning callbacks rather than requiring them as positional arguments. This prevents forcing specific logging contracts on consumers and maintains a flexible API surface for varied environments.
