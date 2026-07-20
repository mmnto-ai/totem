## Lesson — Leverage Git-native attributes for configuration

**Tags:** git, architecture, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Using standard `.gitattributes` markers like `linguist-generated` avoids inventing proprietary configuration schemas. This provides an intuitive, Git-native escape hatch for developers to override default tool behaviors.
