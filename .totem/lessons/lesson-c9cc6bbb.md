## Lesson — The @ast-grep/napi findAll method accepts both string

**Tags:** ast-grep, typescript, api-design

The @ast-grep/napi `findAll` method accepts both string patterns and `NapiConfig` objects natively. Avoid redundant `typeof` checks or manual branching when passing rules to the engine, as it handles the polymorphism internally.
