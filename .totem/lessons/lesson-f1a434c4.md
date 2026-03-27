## Lesson — Lint rules targeting module imports must account for both

**Tags:** linting, regex, javascript

Lint rules targeting module imports must account for both ES Module 'import' statements and CommonJS 'require' calls. Failure to include CommonJS patterns allows developers to bypass architectural restrictions using legacy syntax.
